/**
 * 回测 API 集成测试: GET /api/backtest
 * 覆盖: 未登录 401 / 参数校验 400 / 正常返回同构 / 同参缓存命中 / 非预置标的限频 429
 * 数据层 mock: 非预置标的返回合成日K且 source='fetch' (避免真实拉取东财),
 *              预置标的走真实实现 (测试库由 beforeAll 预置 1300 根上证合成日K, source='db')
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { loadEnv } from '../src/env'
import type { ResolvedTarget } from '../src/lib/backtest-data'

// ---------------------------------------------------------------- mock 数据层 (仅 getDailyBars)

vi.mock('../src/lib/backtest-data', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/backtest-data')>()
  // 合成 1500 根工作日日K (约 6 年): 工厂函数内自包含构造, 避免引用外层 TDZ 变量
  const synthBars: { date: string; close: number }[] = []
  let t = Date.UTC(2011, 0, 3)
  while (synthBars.length < 1500) {
    const d = new Date(t)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      synthBars.push({
        date: d.toISOString().slice(0, 10),
        close: Math.round(100 * Math.pow(1.0002, synthBars.length) * 1e6) / 1e6
      })
    }
    t += 86400000
  }
  return {
    ...mod,
    getDailyBars: vi.fn(async (target: { secid: string }, minBars: number) => {
      if (mod.PRESET_TARGETS.some(p => p.secid === target.secid)) {
        return mod.getDailyBars(target as ResolvedTarget, minBars)
      }
      return { bars: synthBars, source: 'fetch' as const }
    })
  }
})

// ---------------------------------------------------------------- 工具与生命周期

let app: FastifyInstance
let cookieA = ''
let cookieB = ''

/** 与 api.test.ts 相同的清理顺序: 子表先于用户表; indexData 由本文件独占重建 */
async function cleanup() {
  await prisma.emailCode.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.category.deleteMany()
  await prisma.appSetting.deleteMany()
  await prisma.user.deleteMany()
  await prisma.indexData.deleteMany()
}

function growthBars(n: number): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = []
  let t = Date.UTC(2011, 0, 3)
  while (out.length < n) {
    const d = new Date(t)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      out.push({
        date: d.toISOString().slice(0, 10),
        close: Math.round(100 * Math.pow(1.0002, out.length) * 1e6) / 1e6
      })
    }
    t += 86400000
  }
  return out
}

async function register(email: string, code: string): Promise<string> {
  await prisma.emailCode.create({
    data: {
      email, purpose: 'register',
      codeHash: createHash('sha256').update(`${email}::${code}`).digest('hex'),
      expiresAt: new Date(Date.now() + 600000)
    }
  })
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password123', code } })
  expect(res.statusCode).toBe(200)
  return res.cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

function cookieObj(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split('; ')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1)
  }
  return out
}

beforeAll(async () => {
  app = await buildApp(loadEnv())
  await cleanup()
  // 预置标的上证指数 (1.000001) 合成日K 1300 根: getDailyBars 命中 db 源, 秒回
  await prisma.indexData.createMany({
    data: growthBars(1300).map(b => ({
      id: `1.000001::${b.date}`,
      symbol: '1.000001',
      date: b.date,
      data: { date: b.date, close: b.close }
    }))
  })
  cookieA = await register('bt-a@test.com', '111111')
  cookieB = await register('bt-b@test.com', '222222')
})

afterAll(async () => {
  await cleanup()
  await app.close()
  await prisma.$disconnect()
})

// ---------------------------------------------------------------- a. 认证

describe('认证', () => {
  it('未登录访问 GET /api/backtest 返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backtest?target=1.000001' })
    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------- b. 参数校验

describe('参数校验 (已登录)', () => {
  const cases: [string, string][] = [
    ['target 缺失', '/api/backtest?fee=0.001'],
    ['target 为空', '/api/backtest?target='],
    ['fee=-0.1 低于下界', '/api/backtest?target=1.000001&fee=-0.1'],
    ['fee=0.05 超过 0.03 上限', '/api/backtest?target=1.000001&fee=0.05'],
    ['window=bad 非法取值', '/api/backtest?target=1.000001&window=bad'],
    ['strategy=bad 非法取值', '/api/backtest?target=1.000001&strategy=bad']
  ]
  for (const [name, url] of cases) {
    it(`${name} 返回 400`, async () => {
      const res = await app.inject({ method: 'GET', url, cookies: cookieObj(cookieA) })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.code).toBe(400)
      expect(typeof body.message).toBe('string')
      expect(body.message.length).toBeGreaterThan(0)
    })
  }
})

// ---------------------------------------------------------------- c/d. 正常返回与缓存

describe('正常返回与缓存', () => {
  it('GET /api/backtest?target=1.000001&strategy=a&window=y5&fee=0.0005 返回 200 且结构完整', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/backtest?target=1.000001&strategy=a&window=y5&fee=0.0005',
      cookies: cookieObj(cookieA)
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.code).toBe(200)
    expect(body.message).toBe('success')
    const data = body.data
    expect(data.target).toBe('1.000001')
    expect(data.fee).toBe(0.0005)
    expect(data.window).toBe('y5')
    expect(data.strategy).toBe('a')
    expect(typeof data.name).toBe('string')
    expect(data.cached).toBeFalsy()
    const m = data.metrics
    expect(m !== null && typeof m === 'object').toBe(true)
    for (const key of ['totalInvested', 'endValue', 'totalReturnPct', 'xirrPct', 'maxDrawdownPct', 'maxDrawdownMonths', 'annualizedVolPct', 'sharpe', 'winRatePct']) {
      expect(m).toHaveProperty(key)
    }
    expect(typeof m.totalInvested).toBe('number')
    expect(m.totalInvested).toBeGreaterThan(0)
    expect(typeof m.endValue).toBe('number')
    expect(m.xirrPct === null || typeof m.xirrPct === 'number').toBe(true)
  })

  it('同参数连续请求第二次命中缓存 (cached:true) 且 metrics 一致', async () => {
    const url = '/api/backtest?target=1.000001&strategy=a&window=y5&fee=0.001'
    const r1 = await app.inject({ method: 'GET', url, cookies: cookieObj(cookieA) })
    expect(r1.statusCode).toBe(200)
    expect(r1.json().data.cached).toBeFalsy()
    const r2 = await app.inject({ method: 'GET', url, cookies: cookieObj(cookieA) })
    expect(r2.statusCode).toBe(200)
    expect(r2.json().data.cached).toBe(true)
    expect(r2.json().data.metrics).toEqual(r1.json().data.metrics)
  })
})

// ---------------------------------------------------------------- e. 限频

describe('非预置标的限频 (10 次/小时/用户)', () => {
  it('同一用户第 11 次新标的首拉返回 429 及可读文案', async () => {
    // 前 10 次: 不同非预置标的 (避免缓存), mock 走 fetch 源, 应全部 200
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/backtest?target=1.9000${String(i).padStart(2, '0')}&window=y5`,
        cookies: cookieObj(cookieB)
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().code).toBe(200)
    }
    // 第 11 次: 达到上限 -> 429
    const res = await app.inject({
      method: 'GET',
      url: '/api/backtest?target=1.900010&window=y5',
      cookies: cookieObj(cookieB)
    })
    expect(res.statusCode).toBe(429)
    const body = res.json()
    expect(body.code).toBe(429)
    expect(body.message).toMatch(/频繁|稍后/)
  })
})