import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { resetDbForTests } from '@/repos/db'
import { usePortfolioStore, setTodayForTests } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import { planConversion } from '@/lib/conversion'

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
  setTodayForTests('2026-08-13') // 周四, 跨周末测试
})
afterEach(() => setTodayForTests(null))

async function seed() {
  const settings = useSettingsStore(); await settings.load()
  const p = usePortfolioStore()
  // 源: A 1.00 元 1000 份 — 初始 quantity=0, 走 buy txn 1000 份建仓
  const a = await p.addHolding({
    symbol: 'A001', name: '基金A', market: 'CN', currency: 'CNY', type: 'etf', category: 'other',
    quantity: 0, avgCost: 0, currentPrice: 100, currentPriceAt: Date.now()
  })
  await p.addTxn({ holdingId: a.id, side: 'buy', date: '2026-08-01', price: 100, quantity: 1000, fee: 0 })
  return { p, a }
}

describe('planConversion 纯计算', () => {
  it('部分转换: 300 份 @ 1.00 → 目标 2.00 → 150 份 (无费用)', () => {
    const plan = planConversion({
      sourceShares: 300, amountFen: null,
      sourcePriceFen: 100, targetPriceFen: 200,
      sourceSettleDays: 1, targetSettleDays: 1,
      todayISO: '2026-08-10'
    })
    expect(plan.targetShares).toBe(150)
    expect(plan.grossFen).toBe(30000)
    expect(plan.netFen).toBe(30000)
  })

  it('扣除费用: 净额 = 总额 - 费用', () => {
    const plan = planConversion({
      sourceShares: 100, amountFen: null,
      sourcePriceFen: 100, targetPriceFen: 200,
      sourceSettleDays: 1, targetSettleDays: 1,
      feeFen: 100, todayISO: '2026-08-10'
    })
    expect(plan.grossFen).toBe(10000)
    expect(plan.netFen).toBe(9900)
    expect(plan.targetShares).toBe(49.5)
  })

  it('跨周末 T+1: 源/目标确认日均推算正确', () => {
    const plan = planConversion({
      sourceShares: 100, amountFen: null,
      sourcePriceFen: 100, targetPriceFen: 200,
      sourceSettleDays: 1, targetSettleDays: 1,
      todayISO: '2026-08-14' // 周五
    })
    expect(plan.sourceConfirmDate).toBe('2026-08-17') // 下周一
    expect(plan.targetConfirmDate).toBe('2026-08-17')
    expect(plan.earningsStartDate).toBe('2026-08-17')
  })

  it('收益起算日取两者较晚的确认日', () => {
    const plan = planConversion({
      sourceShares: 100, amountFen: null,
      sourcePriceFen: 100, targetPriceFen: 200,
      sourceSettleDays: 1, targetSettleDays: 2, // 目标更慢
      todayISO: '2026-08-13' // 周四
    })
    // 源: 8-13+1=8-14; 目标: 8-13+2=8-17
    expect(plan.sourceConfirmDate).toBe('2026-08-14')
    expect(plan.targetConfirmDate).toBe('2026-08-17')
    expect(plan.earningsStartDate).toBe('2026-08-17')
  })

  it('按金额转换 (amountFen)', () => {
    const plan = planConversion({
      sourceShares: null, amountFen: 10000, // 100 元
      sourcePriceFen: 100, targetPriceFen: 200,
      sourceSettleDays: 1, targetSettleDays: 1,
      todayISO: '2026-08-10'
    })
    expect(plan.sourceShares).toBe(100) // 100 元 / 1.00 元
    expect(plan.targetShares).toBe(50)
  })

  it('非正金额抛错', () => {
    expect(() => planConversion({
      sourceShares: null, amountFen: 0,
      sourcePriceFen: 100, targetPriceFen: 200,
      sourceSettleDays: 1, targetSettleDays: 1, todayISO: '2026-08-10'
    })).toThrow()
  })
})

describe('convertPosition store action', () => {
  it('部分转换: 300 份 A → B (目标已存在)', async () => {
    const { p, a } = await seed()
    // 预存 B
    const b = await p.addHolding({
      symbol: 'B002', name: '基金B', market: 'CN', currency: 'CNY', type: 'etf', category: 'other',
      quantity: 0, avgCost: 0, currentPrice: 200, currentPriceAt: Date.now()
    })
    const r = await p.convertPosition(a.id, { symbol: 'B002', priceFen: 200 },
      { mode: 'shares', value: 300, date: '2026-08-01' }) // 历史日期: 卖出立即到账
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.targetCreated).toBe(false)
      expect(r.plan.targetShares).toBe(150)
    }
    await p.refresh()
    expect(p.holdings.find(h => h.id === a.id)!.quantity).toBe(700) // 1000-300
    expect(p.holdings.find(h => h.id === b.id)!.quantity).toBeCloseTo(150, 5)
  })

  it('全部转换: A → C (目标未添加 → 自动建仓)', async () => {
    const { p, a } = await seed()
    const r = await p.convertPosition(a.id,
      { symbol: 'C003', name: '新建基金C', priceFen: 250 },
      { mode: 'all', date: '2026-08-01' }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.targetCreated).toBe(true)
      expect(r.plan.targetShares).toBe(400) // 1000 份 * 1.00 元 / 2.50 元 = 400 份
    }
    await p.refresh()
    const aView = p.holdings.find(h => h.id === a.id)!
    expect(aView.quantity).toBe(0)
    expect(aView.isClosed).toBe(true)
    const cView = p.holdings.find(h => h.symbol === 'C003')!
    expect(cView).toBeDefined()
    expect(cView.name).toBe('新建基金C')
    expect(cView.category).toBe('other')
  })

  it('源与目标相同 → same-target 拒绝', async () => {
    const { p, a } = await seed()
    const r = await p.convertPosition(a.id, { symbol: 'A001', priceFen: 100 }, { mode: 'shares', value: 100 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('same-target')
  })

  it('转出份额超额 → exceeds-held', async () => {
    const { p, a } = await seed()
    const r = await p.convertPosition(a.id, { symbol: 'B002', priceFen: 200 }, { mode: 'shares', value: 2000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('exceeds-held')
  })

  it('源无现价 → no-price', async () => {
    const settings = useSettingsStore(); await settings.load()
    const p = usePortfolioStore()
    const a = await p.addHolding({
      symbol: 'NP01', name: 'NoPrice', market: 'US', currency: 'USD', type: 'etf', category: 'other',
      quantity: 10, avgCost: 100, currentPrice: null, currentPriceAt: null
    })
    const r = await p.convertPosition(a.id, { symbol: 'B002', priceFen: 200 }, { mode: 'all' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-price')
  })

  it('QDII 名称新建 → settleDays=2', async () => {
    const { p, a } = await seed()
    const r = await p.convertPosition(a.id,
      { symbol: 'Q004', name: '广发纳斯达克100联接', priceFen: 200 },
      { mode: 'shares', value: 100 }
    )
    expect(r.ok).toBe(true)
    await p.refresh()
    const q = p.holdings.find(h => h.symbol === 'Q004')!
    expect(q.settleDays).toBe(2)
  })
})
