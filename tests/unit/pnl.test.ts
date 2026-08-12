import { describe, it, expect } from 'vitest'
import { computePnL } from '@/lib/pnl'

describe('computePnL', () => {
  it('盈利: currentPrice > avgCost', () => {
    const r = computePnL({ quantity: 100, avgCost: 5000, currentPrice: 6000 })
    expect(r.marketValue).toBe(600000)
    expect(r.totalCost).toBe(500000)
    expect(r.unrealized).toBe(100000)
    expect(r.unrealizedPct).toBe(20)
  })

  it('亏损', () => {
    const r = computePnL({ quantity: 100, avgCost: 5000, currentPrice: 4000 })
    expect(r.unrealized).toBe(-100000)
    expect(r.unrealizedPct).toBe(-20)
  })

  it('持平', () => {
    const r = computePnL({ quantity: 100, avgCost: 5000, currentPrice: 5000 })
    expect(r.unrealized).toBe(0)
    expect(r.unrealizedPct).toBe(0)
  })

  it('无 currentPrice: 返回 null pnl', () => {
    const r = computePnL({ quantity: 100, avgCost: 5000, currentPrice: null })
    expect(r.unrealized).toBeNull()
    expect(r.marketValue).toBeNull()
    expect(r.totalCost).toBe(500000)
  })

  it('avgCost=0 边界', () => {
    const r = computePnL({ quantity: 100, avgCost: 0, currentPrice: 5000 })
    expect(r.unrealizedPct).toBe(Infinity)
  })
})
