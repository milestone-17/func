import { describe, it, expect, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

import { fetchHoldingPrice, fetchHoldingPrices } from '@/lib/yahoo'

describe('fetchHoldingPrice 路由', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('6 位数字: 走服务端基金净值代理', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url)
      return { ok: true, status: 200, json: async () => ({ items: [{ code: '600519', name: 'x', nav: 1356.31, isEstimate: false, navDate: '2026-01-02', source: 'fundMNFInfo' }] }) } as unknown as Response
    }))
    const r = await fetchHoldingPrice('CN', '600519')
    expect(capturedUrl).toContain('/api/market/fund-quotes')
    expect(r).not.toBeNull()
    expect(r!.price).toBe(1356.31)
    expect(r!.isEstimate).toBe(false)
  })

  it('6 位数字: 代理成功则用净值, 不发其他请求', async () => {
    const fetchSpy = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ items: [{ code: '006260', name: 'x', nav: 1.7811, isEstimate: false, navDate: '2026-08-12', source: 'fundMNFInfo' }] }) }) as unknown as Response
    )
    vi.stubGlobal('fetch', fetchSpy)
    const r = await fetchHoldingPrice('CN', '006260')
    expect(r!.price).toBe(1.7811)
    expect(r!.isEstimate).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('6 位数字: 基金与 push2 都失败 → null (保留原值)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const r = await fetchHoldingPrice('CN', '006260')
    expect(r).toBeNull()
  })

  it('字母代码: 走服务端 Yahoo 代理', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/api/market/yahoo-daily')) {
        return {
          ok: true, status: 200,
          json: async () => ({ bars: [{ date: '2026-01-02', close: 102 }] })
        } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }))
    const r = await fetchHoldingPrice('US', 'QQQ')
    expect(r!.price).toBe(102) // 末个非空 close
    expect(r!.isEstimate).toBe(false)
  })
})

describe('fetchHoldingPrices 批量', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('6 位代码一次批量; 字母走 Yahoo 代理', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      calls.push(u)
      if (u.includes('/api/market/fund-quotes')) {
        return { ok: true, status: 200, json: async () => ({ items: [{ code: '006260', name: 'x', nav: 1.7811, isEstimate: false, navDate: '2026-08-12', source: 'fundMNFInfo' }] }) } as unknown as Response
      }
      if (u.includes('/api/market/yahoo-daily')) {
        return { ok: true, status: 200, json: async () => ({ bars: [{ date: '2026-01-02', close: 500 }] }) } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }))
    const results = await fetchHoldingPrices([
      { id: 'h1', market: 'CN', symbol: '006260' },
      { id: 'h2', market: 'US', symbol: 'QQQ' }
    ])
    expect(results.find(r => r.id === 'h1')?.price).toBe(1.7811)
    expect(results.find(r => r.id === 'h2')?.price).toBe(500)
    expect(calls.some(c => c.includes('fund-quotes'))).toBe(true)
  })

  it('全失败 → 每只 price null, 不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const rs = await fetchHoldingPrices([{ id: 'a', market: 'CN', symbol: '006260' }])
    expect(rs[0].price).toBeNull()
  })
})
