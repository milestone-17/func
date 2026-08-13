import { describe, it, expect, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

// 基金 JSONP 在测试环境无法真正加载, mock 掉网络部分 (验证回落与路由逻辑)
vi.mock('@/lib/fundQuote', () => ({
  fetchFundQuote: vi.fn(async () => null),
  fetchFundNavs: vi.fn(async () => new Map()),
  parsePingzhongDataTrend: vi.fn(),
  parseFundMNFInfo: vi.fn(),
}))

import { fetchHoldingPrice, fetchHoldingPrices } from '@/lib/yahoo'
import { fetchFundQuote, fetchFundNavs } from '@/lib/fundQuote'

const fundQuoteMock = { fetchFundQuote, fetchFundNavs }

describe('fetchHoldingPrice 路由', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(fundQuoteMock.fetchFundQuote).mockResolvedValue(null)
  })

  it('6 位数字: 基金 JSONP 失败 → 回落 push2 (带 ut), f43 返回', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url)
      return { ok: true, status: 200, json: async () => ({ data: { f43: 135631 } }) } as unknown as Response
    }))
    const r = await fetchHoldingPrice('CN', '600519')
    expect(capturedUrl).toContain('push2.eastmoney.com')
    expect(capturedUrl).toContain('ut=')
    expect(r).not.toBeNull()
    expect(r!.price).toBe(1356.31) // 135631 分 → 1356.31 元
    expect(r!.isEstimate).toBe(false)
  })

  it('6 位数字: 基金 JSONP 成功则用基金净值, 不再请求 push2', async () => {
    vi.mocked(fundQuoteMock.fetchFundQuote).mockResolvedValue({
      code: '006260', name: 'x', nav: 1.7811, isEstimate: false, navDate: '2026-08-12', source: 'fundMNFInfo'
    })
    const fetchSpy = vi.fn(async () => ({ ok: false }) as unknown as Response)
    vi.stubGlobal('fetch', fetchSpy)
    const r = await fetchHoldingPrice('CN', '006260')
    expect(r!.price).toBe(1.7811)
    expect(r!.isEstimate).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('6 位数字: 基金与 push2 都失败 → null (保留原值)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const r = await fetchHoldingPrice('CN', '006260')
    expect(r).toBeNull()
  })

  it('字母代码: 走 Yahoo 代理链', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ close: [100, 101, 102] }] } }] } })
    } as unknown as Response)))
    const r = await fetchHoldingPrice('US', 'QQQ')
    expect(r!.price).toBe(102) // 末个非空 close
    expect(r!.isEstimate).toBe(false)
  })
})

describe('fetchHoldingPrices 批量', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(fundQuoteMock.fetchFundNavs).mockResolvedValue(new Map())
  })

  it('6 位代码一次批量; 未命中回落 push2; 字母走 Yahoo', async () => {
    vi.mocked(fundQuoteMock.fetchFundNavs).mockResolvedValue(new Map([
      ['006260', { code: '006260', name: 'x', nav: 1.7811, isEstimate: false, navDate: '2026-08-12', source: 'fundMNFInfo' }]
    ]))
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const s = String(url)
      if (s.includes('chart')) {
        return { ok: true, status: 200, json: async () => ({ chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ close: [1, 2, 3] }] } }] } }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ data: { f43: 10000 } }) } as unknown as Response
    }))
    const rs = await fetchHoldingPrices([
      { id: 'a', market: 'CN', symbol: '006260' }, // 批量命中
      { id: 'b', market: 'CN', symbol: '006261' }, // 未命中 → push2
      { id: 'c', market: 'US', symbol: 'QQQ' },    // 字母 → Yahoo
    ])
    const byId = Object.fromEntries(rs.map(r => [r.id, r]))
    expect(byId.a.price).toBe(1.7811)
    expect(byId.b.price).toBe(100) // f43=10000 → 100 元
    expect(byId.c.price).toBe(3)
    expect(fundQuoteMock.fetchFundNavs).toHaveBeenCalledWith(['006260', '006261'])
  })

  it('全失败 → 每只 price null, 不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const rs = await fetchHoldingPrices([{ id: 'a', market: 'CN', symbol: '006260' }])
    expect(rs[0].price).toBeNull()
  })
})
