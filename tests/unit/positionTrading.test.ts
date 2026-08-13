import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { resetDbForTests } from '@/repos/db'
import { usePortfolioStore, setTodayForTests } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'

function wipeDb() {
  resetDbForTests()
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('func-db')
    req.onsuccess = () => resolve(); req.onerror = () => resolve(); req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await wipeDb()
  setActivePinia(createPinia())
  setTodayForTests('2026-08-11') // 周二
})
afterEach(() => setTodayForTests(null))

async function seedHolding() {
  const settings = useSettingsStore(); await settings.load()
  const p = usePortfolioStore()
  // 现价 1.78 元 = 178 分; 初始 0 份, 走 buy txn 建仓 100 份
  const h = await p.addHolding({
    symbol: '006260', name: '汇添富红利增长混合C', market: 'CN', currency: 'CNY',
    type: 'etf', category: 'dividend', quantity: 0, avgCost: 0,
    currentPrice: 178, currentPriceAt: Date.now()
  })
  await p.addTxn({ holdingId: h.id, side: 'buy', date: '2026-08-01', price: 178, quantity: 100, fee: 0 })
  return { p, h }
}

describe('addPosition 加仓', () => {
  it('按金额加仓 100 元 @ 1.78 → 份额 ≈ 56.18', async () => {
    const { p, h } = await seedHolding()
    const r = await p.addPosition(h.id, { mode: 'amount', value: 100, date: '2026-08-01' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quantity).toBeCloseTo(10000 / 178, 5) // 56.179...
    }
    await p.refresh()
    // 100 + 56.18 ≈ 156.18
    expect(p.holdings[0].quantity).toBeGreaterThan(156)
    expect(p.holdings[0].quantity).toBeLessThan(157)
  })

  it('按份额加仓 50 份', async () => {
    const { p, h } = await seedHolding()
    const r = await p.addPosition(h.id, { mode: 'shares', value: 50, date: '2026-08-01' })
    expect(r.ok).toBe(true)
    await p.refresh()
    expect(p.holdings[0].quantity).toBe(150)
  })

  it('当日买入: pending=true (T+1 未确认)', async () => {
    const { p, h } = await seedHolding()
    const r = await p.addPosition(h.id, { mode: 'amount', value: 100 })
    expect(r.ok && r.pending).toBe(true)
    await p.refresh()
    // 今日 8-11 加仓, 确认日 8-12, 仍为确认中
    expect(p.holdings[0].pendingBuyFen).toBeGreaterThan(0)
  })

  it('历史日期买入: 立即已确认', async () => {
    const { p, h } = await seedHolding()
    const r = await p.addPosition(h.id, { mode: 'amount', value: 100, date: '2026-08-01' })
    expect(r.ok && r.pending).toBe(false)
    await p.refresh()
    expect(p.holdings[0].pendingBuyFen).toBe(0)
    expect(p.holdings[0].quantity).toBeGreaterThan(155)
  })

  it('无现价时拒绝并返回 no-price', async () => {
    const settings = useSettingsStore(); await settings.load()
    const p = usePortfolioStore()
    const h = await p.addHolding({
      symbol: 'NOHX', name: 'NoPrice', market: 'US', currency: 'USD', type: 'etf', category: 'other',
      quantity: 10, avgCost: 1000, currentPrice: null, currentPriceAt: null
    })
    const r = await p.addPosition(h.id, { mode: 'amount', value: 100 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-price')
  })

  it('非法金额 (0/负) 拒绝', async () => {
    const { p, h } = await seedHolding()
    const r = await p.addPosition(h.id, { mode: 'amount', value: 0 })
    expect(r.ok).toBe(false)
  })
})

describe('reducePosition 减仓/全部卖出', () => {
  it('按份额减仓 30 份 → 剩余 70', async () => {
    const { p, h } = await seedHolding()
    const r = await p.reducePosition(h.id, { mode: 'shares', value: 30, date: '2026-08-01' })
    expect(r.ok).toBe(true)
    await p.refresh()
    expect(p.holdings[0].quantity).toBe(70)
  })

  it('全部卖出 → 数量 0 + isClosed', async () => {
    const { p, h } = await seedHolding()
    const r = await p.reducePosition(h.id, { mode: 'all', date: '2026-08-01' })
    expect(r.ok).toBe(true)
    await p.refresh()
    expect(p.holdings[0].quantity).toBe(0)
    expect(p.holdings[0].isClosed).toBe(true)
  })

  it('按金额减仓 50 元 @ 1.78 → 份额 ≈ 28.09', async () => {
    const { p, h } = await seedHolding()
    const r = await p.reducePosition(h.id, { mode: 'amount', value: 50, date: '2026-08-01' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quantity).toBeCloseTo(5000 / 178, 5)
    }
  })

  it('减仓份额超额 → exceeds-held', async () => {
    const { p, h } = await seedHolding()
    const r = await p.reducePosition(h.id, { mode: 'shares', value: 200, date: '2026-08-01' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('exceeds-held')
  })

  it('减仓金额超过持有市值 → amount-exceeds', async () => {
    const { p, h } = await seedHolding()
    // 持有 100 份 * 1.78 = 178 元, 尝试减仓 1000 元
    const r = await p.reducePosition(h.id, { mode: 'amount', value: 1000, date: '2026-08-01' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('amount-exceeds')
  })

  it('未到账卖出: 份额冻结 + 金额在途', async () => {
    const { p, h } = await seedHolding()
    const r = await p.reducePosition(h.id, { mode: 'shares', value: 30 }) // 今日 8-11 卖出, T+1 确认 8-12, 未到账
    expect(r.ok && r.pending).toBe(true)
    await p.refresh()
    expect(p.holdings[0].frozenShares).toBe(30)
    expect(p.holdings[0].pendingSellFen).toBeGreaterThan(0)
  })

  it('加仓后再减仓, 重建数据一致', async () => {
    const { p, h } = await seedHolding()
    await p.addPosition(h.id, { mode: 'amount', value: 178, date: '2026-08-01' }) // 加 100 份
    await p.addPosition(h.id, { mode: 'amount', value: 178, date: '2026-08-05' }) // 8-5+1=8-6 已确认
    await p.refresh()
    const after = p.holdings[0].quantity
    expect(after).toBeGreaterThan(295)
    await p.reducePosition(h.id, { mode: 'all', date: '2026-08-05' })
    await p.refresh()
    expect(p.holdings[0].quantity).toBe(0)
    expect(p.holdings[0].isClosed).toBe(true)
  })
})
