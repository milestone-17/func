import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { loadEnv } from '../src/env'
import { prisma } from '../src/lib/prisma'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let adminToken: string
let userToken: string
let userId: string

beforeAll(async () => {
  process.env.ADMIN_EMAIL = 'admin@test.com'
  app = await buildApp(loadEnv())
  const admin = await prisma.user.create({
    data: { email: 'admin@test.com', passwordHash: 'x', provider: 'email', emailVerified: true, role: 'admin' }
  })
  const user = await prisma.user.create({
    data: { email: 'plain@test.com', passwordHash: 'x', provider: 'email', emailVerified: true, role: 'user' }
  })
  userId = user.id
  adminToken = app.jwt.sign({ sub: admin.id })
  userToken = app.jwt.sign({ sub: user.id })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: ['admin@test.com', 'plain@test.com'] } } })
  await app.close()
  await prisma.$disconnect()
})

describe('admin 权限', () => {
  it('普通用户访问 /api/admin/* → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', cookies: { func_token: userToken } })
    expect(res.statusCode).toBe(403)
  })

  it('未登录访问 /api/admin/* → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users' })
    expect(res.statusCode).toBe(401)
  })

  it('admin 获取用户列表', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', cookies: { func_token: adminToken } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { items: Array<{ email: string; role: string }> }
    expect(body.items.some(u => u.email === 'plain@test.com')).toBe(true)
  })

  it('admin 获取统计', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats', cookies: { func_token: adminToken } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { users: { total: number }; data: { transactions: number } }
    expect(body.users.total).toBeGreaterThanOrEqual(2)
    expect(body.data).toHaveProperty('transactions')
  })

  it('禁用后该用户请求 401, 启用后恢复', async () => {
    const dis = await app.inject({ method: 'POST', url: `/api/admin/users/${userId}/disable`, cookies: { func_token: adminToken } })
    expect(dis.statusCode).toBe(200)
    const blocked = await app.inject({ method: 'GET', url: '/api/me', cookies: { func_token: userToken } })
    expect(blocked.statusCode).toBe(401)
    const en = await app.inject({ method: 'POST', url: `/api/admin/users/${userId}/enable`, cookies: { func_token: adminToken } })
    expect(en.statusCode).toBe(200)
    const ok = await app.inject({ method: 'GET', url: '/api/me', cookies: { func_token: userToken } })
    expect(ok.statusCode).toBe(200)
  })

  it('不能禁用/删除 admin 自己', async () => {
    const adminUser = await prisma.user.findUnique({ where: { email: 'admin@test.com' } })
    const res = await app.inject({ method: 'POST', url: `/api/admin/users/${adminUser!.id}/disable`, cookies: { func_token: adminToken } })
    expect(res.statusCode).toBe(400)
  })
})

describe('行情代理接口', () => {
  it('fund-quotes 无 codes → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/market/fund-quotes', cookies: { func_token: userToken } })
    expect(res.statusCode).toBe(400)
  })

  it('monthly 非法 secid → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/market/monthly?secid=xx', cookies: { func_token: userToken } })
    expect(res.statusCode).toBe(400)
  })

  it('yahoo-daily 非法 range → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/market/yahoo-daily?symbol=QQQ&range=99y', cookies: { func_token: userToken } })
    expect(res.statusCode).toBe(400)
  })
})
