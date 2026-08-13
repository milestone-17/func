import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { resetDbForTests } from '@/repos/db'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import { fetchLiveQuotes, fetchHoldingPrice } from '@/lib/yahoo'

function wipeDb() {
  resetDbForTests()
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('func-db')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await wipeDb()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('现价拉取', () => {
  it('fetchLiveQuotes 全失败返回 null, 不抛出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const r = await fetchLiveQuotes('^NDX')
    expect(r).toBeNull()
  })

  it('fetchHoldingPrice 不支持的市场返回 null', async () => {
    const r = await fetchHoldingPrice('HK', '0700')
    expect(r).toBeNull()
  })

  it('refreshAllPrices: 单只失败不清空其他持仓现价', async () => {
    const settings = useSettingsStore()
    await settings.load()
    const p = usePortfolioStore()
    const ok = await p.addHolding({
      symbol: 'OK1', name: 'OK', market: 'US', currency: 'USD', type: 'etf', category: 'nasdaq100',
      quantity: 10, avgCost: 500000, currentPrice: 500000, currentPriceAt: Date.now()
    })
    await p.addTxn({ holdingId: ok.id, side: 'buy', date: '2026-08-01', price: 500000, quantity: 10, fee: 0 })
    const bad = await p.addHolding({
      symbol: 'BAD1', name: 'BAD', market: 'US', currency: 'USD', type: 'etf', category: 'sp500',
      quantity: 10, avgCost: 500000, currentPrice: 500000, currentPriceAt: Date.now()
    })
    await p.addTxn({ holdingId: bad.id, side: 'buy', date: '2026-08-01', price: 500000, quantity: 10, fee: 0 })

    // OK1 拉到 520 元; BAD1 全部抛错
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('OK1')) {
        return {
          ok: true, status: 200,
          json: async () => ({ chart: { result: [{ timestamp: [1, 2, 3, 4, 5], indicators: { quote: [{ close: [510, 515, 518, 519, 520] }] } }] } }),
          text: async () => ''
        } as unknown as Response
      }
      throw new Error('network')
    }))

    const r = await p.refreshAllPrices()
    expect(r.updated).toBe(1)
    expect(r.failed.length).toBe(1)

    await p.refresh()
    const okView = p.holdings.find(h => h.id === ok.id)
    const badView = p.holdings.find(h => h.id === bad.id)
    expect(okView?.currentPrice).toBe(52000)        // yuanToFen(520) = 52000 分
    expect(badView?.currentPrice).toBe(500000)      // 失败保留原值, 未清空
  })
})

describe('分类聚合', () => {
  it('byCategory 小计 = 该类持仓本币市值之和 (外币按汇率换算)', async () => {
    const settings = useSettingsStore()
    await settings.load()
    const p = usePortfolioStore()

    // CNY 持仓 · nasdaq100 · 现价 10 元(1000分) · 100 份 → 100000 分
    const cn = await p.addHolding({
      symbol: 'CN1', name: 'CN', market: 'CN', currency: 'CNY', type: 'stock', category: 'nasdaq100',
      quantity: 0, avgCost: 0, currentPrice: 1000, currentPriceAt: Date.now()
    })
    await p.addTxn({ holdingId: cn.id, side: 'buy', date: '2026-08-01', price: 1000, quantity: 100, fee: 0 })
    // USD 持仓 · nasdaq100 · 现价 100 美元(10000分) · 10 份 → 100000 分 USD → ×7.2 = 720000 分 CNY
    const us = await p.addHolding({
      symbol: 'US1', name: 'US', market: 'US', currency: 'USD', type: 'stock', category: 'nasdaq100',
      quantity: 0, avgCost: 0, currentPrice: 10000, currentPriceAt: Date.now()
    })
    await p.addTxn({ holdingId: us.id, side: 'buy', date: '2026-08-01', price: 10000, quantity: 10, fee: 0 })
    // 债券分类
    const bd = await p.addHolding({
      symbol: 'BD1', name: 'BD', market: 'CN', currency: 'CNY', type: 'bond', category: 'bond',
      quantity: 0, avgCost: 0, currentPrice: 50000, currentPriceAt: Date.now()
    })
    await p.addTxn({ holdingId: bd.id, side: 'buy', date: '2026-08-01', price: 50000, quantity: 1, fee: 0 })

    await p.refresh()
    const ndx = p.byCategory['nasdaq100']
    expect(ndx.count).toBe(2)
    expect(ndx.marketValueCNY).toBe(100000 + 720000) // 820000
    expect(p.byCategory['bond'].marketValueCNY).toBe(50000)
    expect(p.byCategory['sp500']?.count ?? 0).toBe(0)
  })
})
