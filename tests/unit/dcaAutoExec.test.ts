import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { weekOfMonth, monthOf } from '@/lib/dcaWeek'
import { setTodayForTests } from '@/stores/portfolio'
import { setDcaTodayForTests, useDcaStore } from '@/stores/dca'
import { resetDbForTests } from '@/repos/db'
import { holdingRepo } from '@/repos/holdingRepo'
import { dcaConfigRepo } from '@/repos/dcaConfigRepo'
import { dcaExecutionRepo } from '@/repos/dcaExecutionRepo'
import { holdingTxnRepo } from '@/repos/holdingTxnRepo'
import { indexDataRepo } from '@/repos/indexDataRepo'

function wipeDb() {
  resetDbForTests()
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('func-db')
    req.onsuccess = () => resolve(); req.onerror = () => resolve(); req.onblocked = () => resolve()
  })
}

async function resetAll() { await wipeDb() }

describe('weekOfMonth / monthOf', () => {
  it('weekOfMonth 1-7 → 1', () => {
    expect(weekOfMonth('2026-08-01')).toBe(1)
    expect(weekOfMonth('2026-08-07')).toBe(1)
  })
  it('weekOfMonth 8-14 → 2', () => {
    expect(weekOfMonth('2026-08-08')).toBe(2)
    expect(weekOfMonth('2026-08-14')).toBe(2)
  })
  it('weekOfMonth 15-21 → 3', () => {
    expect(weekOfMonth('2026-08-15')).toBe(3)
    expect(weekOfMonth('2026-08-21')).toBe(3)
  })
  it('weekOfMonth 22+ → 4', () => {
    expect(weekOfMonth('2026-08-22')).toBe(4)
    expect(weekOfMonth('2026-08-31')).toBe(4)
  })
  it('monthOf → YYYY-MM', () => {
    expect(monthOf('2026-08-13')).toBe('2026-08')
  })
  it('非法日期 → 默认 1 (容错)', () => {
    expect(weekOfMonth('not-a-date')).toBe(1)
  })
})

describe('DCA store · runAutoExecutions', () => {
  beforeEach(async () => {
    await resetAll()
    setActivePinia(createPinia())
  })
  afterEach(() => {
    setTodayForTests(null)
    setDcaTodayForTests(null)
  })

  it('无 config → 跳过所有, 不写执行', async () => {
    const dca = useDcaStore()
    await dca.load()
    const r = await dca.runAutoExecutions('2026-08-13')
    expect(r.executed).toEqual([])
    expect(r.skipped.length).toBe(2) // 两个标的
    expect(r.skipped[0].reason).toBe('no-config')
  })

  it('有 config 但无 targetHoldingId → 跳过 reason=no-target', async () => {
    await dcaConfigRepo.saveBySymbol('^NDX', {
      name: 'NDX定投', symbol: '^NDX',
      monthlyBudget: 80000, weeklySplits: [20000, 20000, 20000, 20000],
      deviationAlertPercent: 5, targetHoldingId: null
    })
    const dca = useDcaStore()
    await dca.load()
    const r = await dca.runAutoExecutions('2026-08-13')
    expect(r.skipped.some(s => s.symbol === '^NDX' && s.reason === 'no-target')).toBe(true)
  })

  it('有 targetHoldingId + 当周无执行 → 自动记账 + 落 buy 交易', async () => {
    // 准备目标基金: 006260 现价 1.78 元 → 178 分
    const h = await holdingRepo.add({
      symbol: '006260', name: '汇添富红利增长混合C',
      market: 'CN', currency: 'CNY', type: 'etf', category: 'dividend',
      quantity: 0, avgCost: 0, currentPrice: 178, currentPriceAt: Date.now(),
      settleDays: 1
    })
    // 直接写 260 条 indexData (NDX) — 避开 yahoo 拉取
    for (let i = 0; i < 260; i++) {
      await indexDataRepo.put({
        symbol: '^NDX',
        date: `2026-${String((i % 9) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        close: 15000 + i, ma250: 15000, source: 'manual', fetchedAt: Date.now()
      })
    }
    // 配置 NDX 定投, 目标 = 汇添富
    await dcaConfigRepo.saveBySymbol('^NDX', {
      name: 'NDX定投', symbol: '^NDX',
      monthlyBudget: 80000, weeklySplits: [20000, 20000, 20000, 20000],
      deviationAlertPercent: 5, targetHoldingId: h.id
    })
    const dca = useDcaStore()
    await dca.load()
    const today = '2026-08-13' // week 2
    const r = await dca.runAutoExecutions(today)
    const exec = r.executed.find(e => e.symbol === '^NDX')
    expect(exec).toBeDefined()
    expect(exec!.weekIndex).toBe(2)
    expect(exec!.amount).toBeGreaterThan(0)
    // 落库 buy 交易
    const txns = await holdingTxnRepo.listByHolding(h.id)
    const buy = txns.find(t => t.note?.includes('定投自动执行') && t.note?.includes('^NDX'))
    expect(buy).toBeDefined()
    expect(buy!.side).toBe('buy')
    expect(buy!.quantity).toBeCloseTo(exec!.amount / 100 / 1.78, 2) // 元/元 = 份
    // 落库 execution
    const slot = await dcaExecutionRepo.findBySlot((await dcaConfigRepo.getBySymbol('^NDX'))!.id, '2026-08', 2)
    expect(slot).toBeDefined()
    expect(slot!.executedAmount).toBe(exec!.amount)
  })

  it('同槽位重复调用 → 幂等, 不重复落账', async () => {
    const h = await holdingRepo.add({
      symbol: '006260', name: '汇添富红利增长混合C',
      market: 'CN', currency: 'CNY', type: 'etf', category: 'dividend',
      quantity: 0, avgCost: 0, currentPrice: 178, currentPriceAt: Date.now(),
      settleDays: 1
    })
    for (let i = 0; i < 260; i++) {
      await indexDataRepo.put({
        symbol: '^NDX', date: `2026-${String((i % 9) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        close: 15000 + i, ma250: 15000, source: 'manual', fetchedAt: Date.now()
      })
    }
    await dcaConfigRepo.saveBySymbol('^NDX', {
      name: 'NDX定投', symbol: '^NDX',
      monthlyBudget: 80000, weeklySplits: [20000, 20000, 20000, 20000],
      deviationAlertPercent: 5, targetHoldingId: h.id
    })
    const dca = useDcaStore()
    await dca.load()
    const today = '2026-08-13'
    const r1 = await dca.runAutoExecutions(today)
    const r2 = await dca.runAutoExecutions(today)
    expect(r1.executed.some(e => e.symbol === '^NDX')).toBe(true)
    expect(r2.executed.length).toBe(0)
    expect(r2.skipped.find(s => s.symbol === '^NDX')?.reason).toBe('already-executed')
    // 持仓 buy 交易仍只有 1 笔
    const txns = await holdingTxnRepo.listByHolding(h.id)
    const buys = txns.filter(t => t.note?.includes('定投自动执行'))
    expect(buys.length).toBe(1)
  })

  it('手动 recordExecution(targetHoldingId) → 落 buy 交易 (settlement 确认前不计入持仓)', async () => {
    const h = await holdingRepo.add({
      symbol: '006260', name: '汇添富红利增长混合C',
      market: 'CN', currency: 'CNY', type: 'etf', category: 'dividend',
      quantity: 0, avgCost: 0, currentPrice: 178, currentPriceAt: Date.now(),
      settleDays: 1
    })
    for (let i = 0; i < 260; i++) {
      await indexDataRepo.put({
        symbol: '^NDX', date: `2026-${String((i % 9) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        close: 15000 + i, ma250: 15000, source: 'manual', fetchedAt: Date.now()
      })
    }
    await dcaConfigRepo.saveBySymbol('^NDX', {
      name: 'NDX定投', symbol: '^NDX',
      monthlyBudget: 80000, weeklySplits: [20000, 20000, 20000, 20000],
      deviationAlertPercent: 5, targetHoldingId: h.id
    })
    const dca = useDcaStore()
    await dca.load()
    setDcaTodayForTests('2026-08-13')
    // 手动: 第 1 周 100 元
    await dca.recordExecution(1, 10000)
    const txns = await holdingTxnRepo.listByHolding(h.id)
    const buy = txns.find(t => t.note?.includes('定投自动执行·W1'))
    expect(buy).toBeDefined()
    expect(buy!.side).toBe('buy')
  })
})
