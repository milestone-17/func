import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { resetDbForTests } from '@/repos/db'
import { useLedgerStore } from '@/stores/ledger'
import { useBudgetStore } from '@/stores/budget'
import { usePortfolioStore } from '@/stores/portfolio'
import { usePermanentStore } from '@/stores/permanent'
import { useDcaStore } from '@/stores/dca'
import { useSettingsStore } from '@/stores/settings'
import { settingsRepo } from '@/repos/settingsRepo'
import { transactionRepo } from '@/repos/transactionRepo'

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
  vi.restoreAllMocks()
})

describe('设置 store', () => {
  it('默认设置 + 保存回读', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.settings?.usdCnyRate).toBe(7.2)
    expect(s.settings?.permanentThreshold).toBe(5)
    await s.save({ permanentThreshold: 8 })
    const again = await settingsRepo.get()
    expect(again.permanentThreshold).toBe(8)
    expect(again.usdCnyRate).toBe(7.2)
  })
})

describe('账本 store', () => {
  it('记账 + 月度统计', async () => {
    const l = useLedgerStore()
    await l.refreshCategories()
    expect(l.categories.length).toBeGreaterThan(0)
    const cat = l.categories[0]
    await l.addTx({ date: '2026-08-01', type: 'expense', amount: 1234, categoryId: cat.id, note: '午饭' })
    await l.addTx({ date: '2026-08-02', type: 'income', amount: 500000, categoryId: cat.id })
    expect(l.transactions.length).toBe(2)
    const stat = l.monthStats.get('2026-08')
    expect(stat?.expense).toBe(1234)
    expect(stat?.income).toBe(500000)
    // 删除软删
    await l.deleteTx(l.transactions[0].id)
    expect(l.transactions.length).toBe(1)
    const all = await transactionRepo.list()
    expect(all.length).toBe(1)
  })
})

describe('预算 store', () => {
  it('保存分配 → 生成周分扣', async () => {
    const b = useBudgetStore()
    await b.load()
    await b.upsertPlan([
      { type: 'savings', label: '应急金', amountFen: 100000 },
      { type: 'investment', label: '定投', amountFen: 200000 },
      { type: 'fixed', label: '房租', amountFen: 100000 }
    ])
    expect(b.plan).toBeTruthy()
    // savings + investment = 300000 分 → 4 周均分 75000
    expect(b.plan!.weeklySplits).toEqual([75000, 75000, 75000, 75000])
    expect(b.plan!.remainingForDCA).toBe(300000)
  })
})

describe('投资组合 store', () => {
  it('建仓 + 首笔交易 → 平均成本', async () => {
    const p = usePortfolioStore()
    await p.refresh()
    const h = await p.addHolding({
      symbol: 'QQQ', name: '纳指100', market: 'US', currency: 'USD', type: 'etf',
      quantity: 0, avgCost: 0, currentPrice: null, currentPriceAt: null
    })
    await p.addTxn({ holdingId: h.id, side: 'buy', date: '2026-08-01', price: 500000, quantity: 2, fee: 100 })
    await p.refresh()
    const view = p.holdings.find(x => x.id === h.id)
    expect(view?.quantity).toBe(2)
    expect(view?.avgCost).toBe(500050) // (500000*2 + 100) / 2 = 1000100 / 2
    await p.updatePrice(h.id, 510000)
    await p.refresh()
    const view2 = p.holdings.find(x => x.id === h.id)
    expect(view2?.currentPrice).toBe(510000)
    expect(view2?.marketValueCNY).toBe(7344000) // 510000*2 = 1020000 USD → × 7.2 折算 CNY
  })
})

describe('永久组合 store', () => {
  it('seed 默认目标 + 空持仓分析', async () => {
    const perm = usePermanentStore()
    await perm.load()
    expect(perm.targets.length).toBe(4)
    const r = perm.analysis
    expect(r.total).toBe(0)
    expect(r.alerts.length).toBe(4)
    await perm.setTarget('stock', 40)
    const stock = perm.targets.find(t => t.assetType === 'stock')
    expect(stock?.targetPercent).toBe(40)
  })
})

describe('DCA store', () => {
  it('保存配置 + 同步行情 → 4 周建议', async () => {
    const d = useDcaStore()
    await d.load()
    expect(d.config).toBeNull()
    await d.saveConfig({
      name: '定投', symbol: 'QQQ.US', monthlyBudget: 80000,
      weeklySplits: [20000, 20000, 20000, 20000],
      deviationAlertPercent: 5
    })
    expect(d.config?.weeklySplits).toEqual([20000, 20000, 20000, 20000])

    // mock Yahoo chart API: 生成 260 天收盘价, 最新价高于 MA → 高位
    const closes: number[] = []
    for (let i = 0; i < 260; i++) closes.push(100 + Math.round(Math.sin(i / 10) * 5))
    const timestamps: number[] = []
    const base = Math.floor(Date.UTC(2025, 7, 1) / 1000) // 2025-08-01 (秒)
    for (let i = 0; i < 260; i++) timestamps.push(base + i * 86400)
    const yahooJson = JSON.stringify({
      chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ close: closes }] } }] }
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => yahooJson,
      json: async () => JSON.parse(yahooJson)
    } as Response)))

    const r = await d.syncIndex('QQQ.US')
    expect(r.ok).toBe(true)
    expect(d.lastClose).toBe(closes[259])
    expect(d.ma250).not.toBeNull()
    // 4 周建议都算出来
    expect(d.suggestions[1]).not.toBeNull()
    expect(d.suggestions[2]).not.toBeNull()
    expect(d.suggestions[3]).not.toBeNull()
    expect(d.suggestions[4]).not.toBeNull()
    // 记录一次执行
    await d.recordExecution(1, d.suggestions[1]!.suggestedAmount)
    vi.unstubAllGlobals()
  })
})
