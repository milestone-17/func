/**
 * 红利分数 API 集成测试: GET /api/dividend/score
 * 覆盖: 未登录 401 / 快照存在时 200 结构校验 / 快照缺失时现场刷新兜底 200
 * 数据层 mock: dividend-data 的网络函数全部 mock (避免真实请求东财),
 *              dividend-run 真实实现 (用 mock 的数据源组装快照并落库)
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { loadEnv } from '../src/env'
import type { Bar, YieldPoint } from '../src/lib/dividend-engine'
import type { TqQuote } from '../src/lib/dividend-data'

// ---------------------------------------------------------------- mock 数据层 (全部网络函数)

vi.mock('../src/lib/dividend-data', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/dividend-data')>()
  const bars: Bar[] = Array.from({ length: 300 }, (_, i) => ({
    date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    close: 10 + i * 0.01
  }))
  const yields: YieldPoint[] = bars.map((b, i) => ({ date: b.date, value: 3 - i * 0.001 }))
  return {
    ...mod,
    fetchConstituentCodes: vi.fn(async () => ['600001', '600002', '600003']),
    fetchTencentQuotes: vi.fn(async () => new Map<string, TqQuote>([
      ['600001', { code: '600001', name: '红利一号', price: 10, marketCap: 100, amount: 5000 }],
      ['600002', { code: '600002', name: '红利二号', price: 20, marketCap: 90, amount: 3000 }],
      ['600003', { code: '600003', name: '分红断档股', price: 8, marketCap: 50, amount: 2000 }]
    ])),
    fetchRoe: vi.fn(async (code: string) => (code === '600001' ? 12 : 8)),
    fetchDividendInfo: vi.fn(async (code: string) => {
      if (code === '600003') return null // 分红数据缺失 → 不入池
      return { ttmDivPerShare: code === '600001' ? 0.62 : 1.0, consecutiveYears: code === '600001' ? 5 : 3, payoutRatio: code === '600001' ? 0.5 : 1.2 }
    }),
    fetchStockVol: vi.fn(async (code: string) => (code === '600001' ? 15 : null)),
    fetchIndexBars: vi.fn(async () => bars),
    fetchTreasuryYields: vi.fn(async () => yields),
    // saveSnapshot/loadSnapshot 走真实实现 (测试库 IndexData)
  }
})

// ---------------------------------------------------------------- 工具与生命周期

let app: FastifyInstance
let cookie = ''

async function cleanup() {
  await prisma.emailCode.deleteMany()
  await prisma.notificationLog.deleteMany()
  await prisma.notificationConfig.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.category.deleteMany()
  await prisma.appSetting.deleteMany()
  await prisma.user.deleteMany()
  await prisma.indexData.deleteMany()
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
  cookie = await register('div-a@test.com', '111111')
})

afterAll(async () => {
  await cleanup()
  await app.close()
  await prisma.$disconnect()
})

// ---------------------------------------------------------------- 用例

describe('GET /api/dividend/score', () => {
  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dividend/score' })
    expect(res.statusCode).toBe(401)
  })

  it('快照存在时返回 200 且结构与文档一致 (cached:true)', async () => {
    // 预置快照行 (模拟 cron 已跑过)
    await prisma.indexData.upsert({
      where: { id: 'dividend-score::latest' },
      create: {
        id: 'dividend-score::latest', symbol: 'dividend-score', date: '2026-10-15',
        data: {
          date: '2026-10-15', sampleCount: 2, skippedCount: 1, notes: [],
          market: { spreadPctile: 0.7, spreadScore: 70, ma250Signal: 100, marketScore: 82, tier: 'strong', tierLabel: '适合投入', indexClose: 5672.93, ma250: 5500 },
          stocks: [{
            code: '600001', name: '红利一号', price: 10, totalScore: 85.4, stockScore: 91.75,
            factors: { yieldScore: 30, continuityScore: 25, payoutScore: 20, qualityScore: 13, lowVolScore: 8 },
            yieldPct: 6.2, consecutiveYears: 5, payoutRatio: 0.5, roe: 12, volAnnualPct: 15, rank: 1
          }],
          generatedAt: '2026-10-15T06:43:00.000Z'
        }
      },
      update: { date: '2026-10-15', data: {} }
    })
    const res = await app.inject({ method: 'GET', url: '/api/dividend/score', cookies: cookieObj(cookie) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.code).toBe(200)
    expect(body.message).toBe('success')
    const data = body.data
    expect(data.date).toBe('2026-10-15')
    expect(data.sampleCount).toBe(2)
    expect(data.skippedCount).toBe(1)
    expect(Array.isArray(data.stocks)).toBe(true)
    expect(data.market.marketScore).toBe(82)
    expect(data.market.tierLabel).toBe('适合投入')
    expect(data.cached).toBe(true)
    const s = data.stocks[0]
    expect(s.factors).toHaveProperty('yieldScore')
    expect(s.factors).toHaveProperty('continuityScore')
    expect(s.factors).toHaveProperty('payoutScore')
    expect(s.factors).toHaveProperty('qualityScore')
    expect(s.factors).toHaveProperty('lowVolScore')
  })

  it('快照缺失时现场刷新兜底返回 200 (cached:false), 并落库快照', async () => {
    // 清掉快照行, 触发现场刷新 (走 mock 数据源 → dividend-run 真实编排)
    await prisma.indexData.deleteMany({ where: { symbol: 'dividend-score' } })
    const res = await app.inject({ method: 'GET', url: '/api/dividend/score', cookies: cookieObj(cookie) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.code).toBe(200)
    const data = body.data
    expect(data.cached).toBe(false)
    // 600003 分红缺失不入池; 样本池 = 2
    expect(data.sampleCount).toBe(2)
    expect(data.skippedCount).toBeGreaterThanOrEqual(1)
    expect(data.market).toBeTruthy()
    expect(data.stocks.length).toBe(2)
    // 快照已落库 (下次请求应命中 cached:true)
    const row = await prisma.indexData.findUnique({ where: { id: 'dividend-score::latest' } })
    expect(row).toBeTruthy()
    const again = await app.inject({ method: 'GET', url: '/api/dividend/score', cookies: cookieObj(cookie) })
    expect(again.json().data.cached).toBe(true)
  })
})
