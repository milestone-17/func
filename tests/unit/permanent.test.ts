import { describe, it, expect } from 'vitest'
import { aggregateByType, computePermanentDeviation, categoryToAssetType } from '@/lib/permanent'

const holdings = [
  { type: 'stock', marketValueCNY: 250000 },
  { type: 'bond', marketValueCNY: 250000 },
  { type: 'cash', marketValueCNY: 250000 },
  { type: 'gold', marketValueCNY: 250000 }
] as any[]

const targets = [
  { assetType: 'stock', targetPercent: 25 },
  { assetType: 'bond', targetPercent: 25 },
  { assetType: 'cash', targetPercent: 25 },
  { assetType: 'gold', targetPercent: 25 }
] as any[]

describe('permanent portfolio', () => {
  it('aggregateByType sums by type', () => {
    const r = aggregateByType(holdings)
    expect(r.stock).toBe(250000)
    expect(r.bond).toBe(250000)
    expect(r.cash).toBe(250000)
    expect(r.gold).toBe(250000)
  })

  it('computePermanentDeviation: 完美匹配', () => {
    const r = computePermanentDeviation(holdings, targets, 5)
    expect(r.total).toBe(1000000)
    r.deviations.forEach(d => expect(d.deviation).toBe(0))
    expect(r.alerts).toEqual([])
  })

  it('computePermanentDeviation: 股票 30% 偏离 +5', () => {
    const h2 = [
      { type: 'stock', marketValueCNY: 300000 },
      { type: 'bond', marketValueCNY: 233333 },
      { type: 'cash', marketValueCNY: 233333 },
      { type: 'gold', marketValueCNY: 233334 }
    ] as any[]
    // 偏离 5%, 阈值用 4 (严格 > 阈值才报警)
    const r = computePermanentDeviation(h2, targets, 4)
    const stockDev = r.deviations.find(d => d.assetType === 'stock')!
    expect(stockDev.actualPercent).toBe(30)
    expect(stockDev.deviation).toBe(5)
    expect(r.alerts.some(a => a.assetType === 'stock')).toBe(true)
  })

  it('computePermanentDeviation: 空持仓 → 全 0 + 全 alert', () => {
    const r = computePermanentDeviation([], targets, 5)
    expect(r.total).toBe(0)
    r.deviations.forEach(d => expect(d.actualPercent).toBe(0))
    expect(r.alerts.length).toBe(4)
  })

  it('computePermanentDeviation: 阈值可配', () => {
    // 股票 40% 偏离 15, 阈值 5 → 报警; 阈值 20 → 不报警
    const h2 = [
      { type: 'stock', marketValueCNY: 400000 },
      { type: 'bond', marketValueCNY: 200000 },
      { type: 'cash', marketValueCNY: 200000 },
      { type: 'gold', marketValueCNY: 200000 }
    ] as any[]
    const r5 = computePermanentDeviation(h2, targets, 5)
    const r20 = computePermanentDeviation(h2, targets, 20)
    expect(r5.alerts.length).toBeGreaterThan(0)
    expect(r20.alerts.length).toBe(0)
  })

  it('computePermanentDeviation: 仅部分类别有持仓 → 其余实际 0% 并报警', () => {
    // 模拟用户只持有股票+债券 (其余无现价被 store 过滤掉) → cash/gold 实际 0%
    const h = [
      { type: 'stock', marketValueCNY: 800000 },
      { type: 'bond', marketValueCNY: 200000 }
    ] as any[]
    const r = computePermanentDeviation(h, targets, 5)
    expect(r.total).toBe(1000000)
    expect(r.deviations.find(d => d.assetType === 'stock')!.actualPercent).toBe(80)
    expect(r.alerts.some(a => a.assetType === 'cash')).toBe(true)
    expect(r.alerts.some(a => a.assetType === 'gold')).toBe(true)
  })
})

describe('categoryToAssetType (分类→四类映射)', () => {
  it('红利/纳指/标普 → 股票 (即便 type 是 etf)', () => {
    expect(categoryToAssetType('dividend', 'etf')).toBe('stock')
    expect(categoryToAssetType('nasdaq100', 'etf')).toBe('stock')
    expect(categoryToAssetType('sp500', 'etf')).toBe('stock')
  })
  it('债券分类 → 债券', () => {
    expect(categoryToAssetType('bond', 'etf')).toBe('bond')
  })
  it('其他/缺省分类按 type: etf→股票, bond→债券, cash/gold 直通', () => {
    expect(categoryToAssetType('other', 'etf')).toBe('stock')
    expect(categoryToAssetType('other', 'bond')).toBe('bond')
    expect(categoryToAssetType('other', 'cash')).toBe('cash')
    expect(categoryToAssetType('other', 'gold')).toBe('gold')
    expect(categoryToAssetType(undefined, 'etf')).toBe('stock')
  })
})

describe('aggregateByType (场外基金按 category 计入)', () => {
  it('红利基金+其他ETF 计入股票, 债券基金计入债券', () => {
    const h = [
      { category: 'dividend', type: 'etf', marketValueCNY: 300000 },
      { category: 'bond', type: 'etf', marketValueCNY: 100000 },
      { category: 'other', type: 'etf', marketValueCNY: 50000 }
    ] as any[]
    const r = aggregateByType(h)
    expect(r.stock).toBe(350000) // dividend(300000) + other-etf(50000)
    expect(r.bond).toBe(100000)
  })
})

describe('computePermanentDeviation (含基金持仓)', () => {
  it('红利基金计入股票, 实际占比正确', () => {
    const h = [
      { category: 'dividend', type: 'etf', marketValueCNY: 750000 },
      { category: 'bond', type: 'etf', marketValueCNY: 250000 }
    ] as any[]
    const tg = [
      { assetType: 'stock', targetPercent: 75 },
      { assetType: 'bond', targetPercent: 25 },
      { assetType: 'cash', targetPercent: 0 },
      { assetType: 'gold', targetPercent: 0 }
    ] as any[]
    const r = computePermanentDeviation(h, tg, 5)
    expect(r.total).toBe(1000000)
    expect(r.deviations.find(d => d.assetType === 'stock')!.actualPercent).toBe(75)
    expect(r.deviations.find(d => d.assetType === 'stock')!.deviation).toBe(0)
  })
})
