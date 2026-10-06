import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { loadEnv } from '../src/env'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let cookieA = ''
let cookieB = ''

async function clearAll() {
  await prisma.emailCode.deleteMany()
  // 资源表先于用户删除: 残留行属主校验会导致 409
  await prisma.transaction.deleteMany()
  await prisma.category.deleteMany()
  await prisma.appSetting.deleteMany()
  await prisma.user.deleteMany()
  await prisma.indexData.deleteMany()
}

async function register(email: string, code: string): Promise<string> {
  await prisma.emailCode.create({
    data: { email, purpose: 'register', codeHash: require('node:crypto').createHash('sha256').update(`${email}::${code}`).digest('hex'), expiresAt: new Date(Date.now() + 600000) }
  })
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password123', code } })
  expect(res.statusCode).toBe(200)
  return res.cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

beforeAll(async () => {
  app = await buildApp(loadEnv())
  await clearAll()
})

afterAll(async () => {
  await clearAll()
  await app.close()
  await prisma.$disconnect()
})

describe('健康检查', () => {
  it('GET /api/health 返回 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true })
  })
})

describe('认证与隔离', () => {
  it('未登录访问业务接口返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transactions' })
    expect(res.statusCode).toBe(401)
  })

  it('用户A注册并写入交易', async () => {
    cookieA = await register('a@test.com', '111111')
    const res = await app.inject({
      method: 'POST', url: '/api/transactions', cookies: cookieObj(cookieA),
      payload: { id: 'tx1', date: '2026-01-01', type: 'expense', amount: 100, createdAt: 1700000000000, updatedAt: 1700000000000 }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().item.amount).toBe(100)
  })

  it('用户B看不到A的交易(隔离)', async () => {
    cookieB = await register('b@test.com', '222222')
    const res = await app.inject({ method: 'GET', url: '/api/transactions', cookies: cookieObj(cookieB) })
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toEqual([])
  })

  it('用户B直接请求A的交易ID返回404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transactions/tx1', cookies: cookieObj(cookieB) })
    expect(res.statusCode).toBe(404)
  })

  it('A能读回自己的交易', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transactions', cookies: cookieObj(cookieA) })
    expect(res.json().items).toHaveLength(1)
    expect(res.json().items[0].id).toBe('tx1')
  })

  it('PUT 更新交易', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/transactions/tx1', cookies: cookieObj(cookieA),
      payload: { id: 'tx1', date: '2026-01-02', type: 'expense', amount: 200, createdAt: 1700000000000, updatedAt: 1700000000001 }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().item.amount).toBe(200)
  })

  it('DELETE 软删后列表不可见,但可再次导入', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/transactions/tx1', cookies: cookieObj(cookieA) })
    expect(res.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: '/api/transactions', cookies: cookieObj(cookieA) })
    const rows = await prisma.transaction.findMany({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'a@test.com' } })).id } })
    expect(rows[0].deletedAt).not.toBeNull()
    expect(list.json().items[0].deletedAt).toBeTruthy()
  })
})

describe('批量导入', () => {
  it('导入 bundle 幂等可重复执行', async () => {
    const bundle = {
      schemaVersion: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      data: {
        transactions: [{ id: 'imp1', date: '2026-02-01', type: 'income', amount: 500, createdAt: 1700000000000, updatedAt: 1700000000000 }],
        categories: [{ id: 'cat1', name: '餐饮', order: 1, createdAt: 1700000000000, updatedAt: 1700000000000 }],
        settings: [{ id: 'app', baseCurrency: 'CNY', usdCnyRate: 7.2, createdAt: 1700000000000, updatedAt: 1700000000000 }]
      }
    }
    const r1 = await app.inject({ method: 'POST', url: '/api/import', cookies: cookieObj(cookieA), payload: bundle })
    expect(r1.statusCode).toBe(200)
    const r2 = await app.inject({ method: 'POST', url: '/api/import', cookies: cookieObj(cookieA), payload: bundle })
    expect(r2.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: '/api/transactions', cookies: cookieObj(cookieA) })
    const imp1 = list.json().items.filter((x: any) => x.id === 'imp1')
    expect(imp1).toHaveLength(1)
  })

  it('非法 bundle 返回 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/import', cookies: cookieObj(cookieA), payload: { foo: 1 } })
    expect(res.statusCode).toBe(400)
  })
})

describe('行情接口', () => {
  it('写入后可读出', async () => {
    await prisma.indexData.create({ data: { id: '^NDX::2026-01-02', symbol: '^NDX', date: '2026-01-02', data: { symbol: '^NDX', date: '2026-01-02', close: 123.45 } } })
    const res = await app.inject({ method: 'GET', url: '/api/market/^NDX' })
    expect(res.statusCode).toBe(200)
    expect(res.json().bars[0].close).toBe(123.45)
    const all = await app.inject({ method: 'GET', url: '/api/market/index-data' })
    expect(all.json().indices['^NDX'].bars).toHaveLength(1)
  })
})

describe('验证码与重置密码', () => {
  it('send-code 对未注册邮箱走 reset 返回 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/send-code', payload: { email: 'nobody@test.com', purpose: 'reset' } })
    expect(res.statusCode).toBe(404)
  })

  it('register 用错误验证码返回 400', async () => {
    await prisma.emailCode.create({
      data: { email: 'c@test.com', purpose: 'register', codeHash: 'bad', expiresAt: new Date(Date.now() + 600000) }
    })
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'c@test.com', password: 'password123', code: '000000' } })
    expect(res.statusCode).toBe(400)
  })

  it('reset-password 用正确验证码可改密码并登录', async () => {
    const email = 'a@test.com'
    const code = '654321'
    await prisma.emailCode.create({
      data: { email, purpose: 'reset', codeHash: require('node:crypto').createHash('sha256').update(`${email}::${code}`).digest('hex'), expiresAt: new Date(Date.now() + 600000) }
    })
    const res = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { email, code, newPassword: 'newpassword123' } })
    expect(res.statusCode).toBe(200)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'newpassword123' } })
    expect(login.statusCode).toBe(200)
  })
})

function cookieObj(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split('; ')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1)
  }
  return out
}
