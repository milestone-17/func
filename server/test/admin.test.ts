import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { buildApp } from '../src/app'
import { loadEnv } from '../src/env'
import { prisma } from '../src/lib/prisma'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let adminToken: string
let userToken: string
let userId: string

/** 用与 server 相同的 HS256 手写逻辑签 admin_token */
function signAdminTokenTest(secret: string, email: string): string {
  const b64 = (s: string) => Buffer.from(s).toString('base64url')
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const exp = Math.floor(Date.now() / 1000) + 2 * 3600
  const body = b64(JSON.stringify({ sub: email, kind: 'admin', exp }))
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

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
  await prisma.adminAudit.deleteMany({ where: { actor: 'admin@test.com' } })
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

describe('独立后台 panel (admin_token)', () => {
  const panelCookie = (): Record<string, string> => ({
    admin_token: signAdminTokenTest(process.env.JWT_SECRET || 'test-secret', 'admin@test.com')
  })

  it('未登录 panel → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/panel/summary' })
    expect(res.statusCode).toBe(401)
  })

  it('summary 返回统计 + 源优先级', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/panel/summary', cookies: panelCookie() })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { users: { total: number }; market: { sourcePriority: string[] } }
    expect(body.users.total).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(body.market.sourcePriority)).toBe(true)
    expect(body.market.sourcePriority.length).toBe(3)
  })

  it('源优先级: 全排列保存生效, 非全排列 400', async () => {
    const ok = await app.inject({
      method: 'POST', url: '/api/admin/panel/source-priority',
      cookies: panelCookie(),
      payload: { priority: ['eastmoney', 'tencent', 'yahoo'] }
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().priority).toEqual(['eastmoney', 'tencent', 'yahoo'])
    // summary 里也生效
    const s = await app.inject({ method: 'GET', url: '/api/admin/panel/summary', cookies: panelCookie() })
    expect(s.json().market.sourcePriority).toEqual(['eastmoney', 'tencent', 'yahoo'])
    // 恢复默认
    await app.inject({
      method: 'POST', url: '/api/admin/panel/source-priority',
      cookies: panelCookie(),
      payload: { priority: ['tencent', 'eastmoney', 'yahoo'] }
    })
    const bad = await app.inject({
      method: 'POST', url: '/api/admin/panel/source-priority',
      cookies: panelCookie(),
      payload: { priority: ['tencent', 'eastmoney'] }
    })
    expect(bad.statusCode).toBe(400)
  })

  it('panel 用户禁用/启用 + 审计写入', async () => {
    const dis = await app.inject({ method: 'PATCH', url: `/api/admin/panel/users/${userId}`, cookies: panelCookie(), payload: { disabled: true } })
    expect(dis.statusCode).toBe(200)
    const u = await prisma.user.findUnique({ where: { id: userId } })
    expect(u!.disabled).toBe(true)
    const en = await app.inject({ method: 'PATCH', url: `/api/admin/panel/users/${userId}`, cookies: panelCookie(), payload: { disabled: false } })
    expect(en.statusCode).toBe(200)
    // 审计已写入
    const audits = await prisma.adminAudit.findMany({ where: { actor: 'admin@test.com', action: { in: ['disable_user', 'enable_user'] } } })
    expect(audits.length).toBeGreaterThanOrEqual(2)
  })

  it('panel 禁用 admin 自己 → 400', async () => {
    const adminUser = await prisma.user.findUnique({ where: { email: 'admin@test.com' } })
    const res = await app.inject({ method: 'PATCH', url: `/api/admin/panel/users/${adminUser!.id}`, cookies: panelCookie(), payload: { disabled: true } })
    expect(res.statusCode).toBe(400)
  })

  it('audit 接口返回记录', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/panel/audit?limit=10', cookies: panelCookie() })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { items: Array<{ action: string }> }
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeGreaterThan(0)
  })

  it('登录接口: 非管理员邮箱 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/auth/login',
      payload: { email: 'plain@test.com', password: 'whatever' }
    })
    expect(res.statusCode).toBe(403)
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
