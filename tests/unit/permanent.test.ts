import { describe, it, expect } from 'vitest'
import { aggregateByType, computePermanentDeviation } from '@/lib/permanent'

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
})
