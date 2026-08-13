import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { resetDbForTests } from '@/repos/db'
import { inferCategory } from '@/lib/category'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'

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

describe('inferCategory', () => {
  it('红利基金 → dividend', () => {
    expect(inferCategory('汇添富红利增长混合C', '006260')).toBe('dividend')
    expect(inferCategory('富国恒生红利ETF联接C', '019261')).toBe('dividend')
    expect(inferCategory('股息精选', '000001')).toBe('dividend')
  })
  it('标普500 → sp500', () => {
    expect(inferCategory('标普500ETF', '513500')).toBe('sp500')
    expect(inferCategory('SPDR S&P 500', 'SPY')).toBe('sp500')
  })
  it('中证500 不误判为标普500 → other', () => {
    expect(inferCategory('中证500ETF', '510500')).toBe('other')
  })
  it('纳指 → nasdaq100', () => {
    expect(inferCategory('纳斯达克100ETF', '513100')).toBe('nasdaq100')
    expect(inferCategory('Invesco QQQ Trust', 'QQQ')).toBe('nasdaq100')
  })
  it('债券 → bond', () => {
    expect(inferCategory('国债ETF', '511010')).toBe('bond')
    expect(inferCategory('信用债基', '000032')).toBe('bond')
  })
  it('无匹配 → other', () => {
    expect(inferCategory('货币市场基金', '000198')).toBe('other')
    expect(inferCategory('', '')).toBe('other')
  })
})

describe('reclassifyAll', () => {
  it('仅重算未分类(其他), 不覆盖用户手动分类', async () => {
    const settings = useSettingsStore()
    await settings.load()
    const p = usePortfolioStore()
    await p.addHolding({ symbol: '006260', name: '汇添富红利增长混合C', market: 'CN', currency: 'CNY', type: 'etf', category: 'other', quantity: 1, avgCost: 1000, currentPrice: 1000, currentPriceAt: Date.now() })
    await p.addHolding({ symbol: '513100', name: '纳斯达克100ETF', market: 'CN', currency: 'CNY', type: 'etf', category: 'other', quantity: 1, avgCost: 1000, currentPrice: 1000, currentPriceAt: Date.now() })
    // 用户已手动分类为 nasdaq100 的中证500 → 不应被覆盖
    await p.addHolding({ symbol: '510500', name: '中证500ETF', market: 'CN', currency: 'CNY', type: 'etf', category: 'nasdaq100', quantity: 1, avgCost: 1000, currentPrice: 1000, currentPriceAt: Date.now() })
    await p.refresh()

    const n = await p.reclassifyAll('unclassified')
    expect(n).toBe(2) // 两只 other 被重算

    await p.refresh()
    expect(p.byCategory['dividend']?.count).toBe(1)
    expect(p.byCategory['nasdaq100']?.count).toBe(2) // 纳指100ETF + 手动那只
    // 中证500 那只保持用户手动的 nasdaq100, 未被重算回 other
    expect(p.holdings.find(h => h.symbol === '510500')?.category).toBe('nasdaq100')
  })
})
