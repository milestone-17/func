import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { resetDbForTests } from '@/repos/db'
import { shouldExecuteToday, computeDailyBuy } from '@/lib/dailyDca'
import { useDailyDcaStore } from '@/stores/dailyDca'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import { holdingTxnRepo } from '@/repos/holdingTxnRepo'
import type { DailyDcaConfig } from '@/types/dca'

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

function cfg(patch: Partial<DailyDcaConfig> = {}): DailyDcaConfig {
  return {
    id: 'daily', enabled: true, holdingId: 'h1', dailyAmountFen: 1000, lastExecutedDate: null,
    createdAt: 0, updatedAt: 0, deletedAt: null, ...patch
  }
}

describe('shouldExecuteToday', () => {
  const today = '2026-08-13'
  it('启用+有持仓+金额>0+今日未执行 → true', () => {
    expect(shouldExecuteToday(cfg(), today)).toBe(true)
  })
  it('今日已执行 → false (幂等)', () => {
    expect(shouldExecuteToday(cfg({ lastExecutedDate: today }), today)).toBe(false)
  })
  it('未启用 → false', () => {
    expect(shouldExecuteToday(cfg({ enabled: false }), today)).toBe(false)
  })
  it('无持仓 → false', () => {
    expect(shouldExecuteToday(cfg({ holdingId: null }), today)).toBe(false)
  })
  it('金额非正 → false', () => {
    expect(shouldExecuteToday(cfg({ dailyAmountFen: 0 }), today)).toBe(false)
    expect(shouldExecuteToday(cfg({ dailyAmountFen: -5 }), today)).toBe(false)
  })
})

describe('computeDailyBuy', () => {
  const today = '2026-08-13'
  it('有效持仓+现价 → 买入交易, 份额=金额/价格', () => {
    const holding = { id: 'h1', currentPrice: 50000 } as any // 500 元/份
    const r = computeDailyBuy(cfg({ dailyAmountFen: 1000 }), holding, today) // 10 元
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.txn.side).toBe('buy')
      expect(r.txn.price).toBe(50000)
      expect(r.txn.quantity).toBe(1000 / 50000) // 0.02 份
      expect(r.txn.note).toBe('每日定投自动')
    }
  })
  it('无现价 → no-price, 不记账', () => {
    const holding = { id: 'h1', currentPrice: null } as any
    const r = computeDailyBuy(cfg(), holding, today)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-price')
  })
  it('现价无效(0) → no-price', () => {
    const holding = { id: 'h1', currentPrice: 0 } as any
    const r = computeDailyBuy(cfg(), holding, today)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-price')
  })
  it('持仓缺失 → invalid', () => {
    const r = computeDailyBuy(cfg(), undefined, today)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid')
  })
})

describe('dailyDca store runIfPending', () => {
  it('当日首次执行写一笔 + 更新 lastExecutedDate; 同日重复不写', async () => {
    const settings = useSettingsStore()
    await settings.load()
    const p = usePortfolioStore()
    const h = await p.addHolding({
      symbol: 'FUND1', name: '基金', market: 'CN', currency: 'CNY', type: 'etf', category: 'other',
      quantity: 10, avgCost: 50000, currentPrice: 50000, currentPriceAt: Date.now()
    })
    await p.addTxn({ holdingId: h.id, side: 'buy', date: '2026-08-01', price: 50000, quantity: 10, fee: 0 })

    const d = useDailyDcaStore()
    await d.load()
    await d.save({ enabled: true, holdingId: h.id, dailyAmountFen: 1000 })

    const before = (await holdingTxnRepo.listByHolding(h.id)).length
    const r1 = await d.runIfPending()
    expect(r1.executed).toBe(true)
    const after1 = (await holdingTxnRepo.listByHolding(h.id)).length
    expect(after1).toBe(before + 1)
    expect(d.config?.lastExecutedDate).toBeTruthy()

    // 同日重复 → 幂等, 不再写
    const r2 = await d.runIfPending()
    expect(r2.executed).toBe(false)
    const after2 = (await holdingTxnRepo.listByHolding(h.id)).length
    expect(after2).toBe(after1)
  })

  it('无现价跳过 → no-price, 不写交易', async () => {
    const settings = useSettingsStore()
    await settings.load()
    const p = usePortfolioStore()
    const h = await p.addHolding({
      symbol: 'NOPR', name: '无价', market: 'CN', currency: 'CNY', type: 'etf', category: 'other',
      quantity: 10, avgCost: 50000, currentPrice: null, currentPriceAt: null
    })
    await p.addTxn({ holdingId: h.id, side: 'buy', date: '2026-08-01', price: 50000, quantity: 10, fee: 0 })
    const d = useDailyDcaStore()
    await d.load()
    await d.save({ enabled: true, holdingId: h.id, dailyAmountFen: 1000 })

    const before = (await holdingTxnRepo.listByHolding(h.id)).length
    const r = await d.runIfPending()
    expect(r.executed).toBe(false)
    expect(r.reason).toBe('no-price')
    const after = (await holdingTxnRepo.listByHolding(h.id)).length
    expect(after).toBe(before)
  })
})
