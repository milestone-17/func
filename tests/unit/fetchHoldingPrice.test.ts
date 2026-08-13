import { describe, it, expect, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

// 基金 JSONP 在测试环境无法真正加载, mock 为立即返回 null (走回落路径)
vi.mock('@/lib/fundQuote', () => ({
  fetchFundQuote: vi.fn(async () => null),
  parseFundGz: vi.fn()
}))

import { fetchHoldingPrice } from '@/lib/yahoo'

describe('fetchHoldingPrice 路由', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('6 位数字代码: 基金 JSONP 失败 → 回落东方财富股票接口', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ data: { f43: 12345 } }) // 123.45 元
    } as unknown as Response)))
    const r = await fetchHoldingPrice('CN', '600519')
    expect(r).not.toBeNull()
    expect(r!.price).toBe(123.45)
    expect(r!.isEstimate).toBe(false)
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

  it('6 位数字且基金与股票接口都失败 → null (保留原值)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const r = await fetchHoldingPrice('CN', '006260')
    expect(r).toBeNull()
  })
})
