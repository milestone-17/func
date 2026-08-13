import { describe, it, expect } from 'vitest'
import { computePosition, settleDaysOf } from '@/lib/position'
import type { HoldingTxn } from '@/types/portfolio'

function buy(date: string, price: number, quantity: number, fee = 0): HoldingTxn {
  return { id: 'x', holdingId: 'h', side: 'buy', date, price, quantity, fee, createdAt: 0, updatedAt: 0, deletedAt: null } as HoldingTxn
}
function sell(date: string, price: number, quantity: number, fee = 0): HoldingTxn {
  return { id: 'x', holdingId: 'h', side: 'sell', date, price, quantity, fee, createdAt: 0, updatedAt: 0, deletedAt: null } as HoldingTxn
}

describe('computePosition 结算感知持仓重建', () => {
  it('全部已确认 → 与传统累加一致', () => {
    const pos = computePosition([buy('2026-08-01', 100, 10), buy('2026-08-02', 200, 5)], 1, '2026-08-10')
    expect(pos.quantity).toBe(15)
    expect(pos.avgCost).toBe(133.33) // (1000+1000)/15
    expect(pos.pendingBuyFen).toBe(0)
    expect(pos.pendingSellFen).toBe(0)
    expect(pos.frozenShares).toBe(0)
  })

  it('T+1 确认中的买入: 不计数量/成本, 金额入在途', () => {
    const txns = [buy('2026-08-10', 178, 100), buy('2026-08-11', 200, 50)]
    const pos = computePosition(txns, 1, '2026-08-11')
    // 8-10 买入今日已确认 (8-10 +1 交易日 = 8-11); 8-11 买入确认日为 8-12, 尚未确认
    expect(pos.quantity).toBe(100)
    expect(pos.pendingBuyFen).toBe(10000) // 200*50
  })

  it('跨周末的 T+2 确认', () => {
    // 周四 8-13 买入, T+2 确认日为下周一 8-17
    const pos = computePosition([buy('2026-08-13', 100, 10)], 2, '2026-08-14')
    expect(pos.quantity).toBe(0)
    expect(pos.pendingBuyFen).toBe(1000)
  })

  it('未到账的卖出: 份额冻结仍计入, 金额入在途', () => {
    const txns = [buy('2026-08-01', 100, 10), sell('2026-08-11', 150, 4)]
    const pos = computePosition(txns, 1, '2026-08-11') // 卖出确认日 8-12, 未到账
    expect(pos.quantity).toBe(10) // 全部仍计入 (冻结)
    expect(pos.frozenShares).toBe(4)
    expect(pos.pendingSellFen).toBe(600)
  })

  it('到账的卖出: 扣数量与成本', () => {
    const txns = [buy('2026-08-01', 100, 10), sell('2026-08-11', 150, 4)]
    const pos = computePosition(txns, 1, '2026-08-12') // 卖出确认日 8-12, 已到账
    expect(pos.quantity).toBe(6)
    expect(pos.frozenShares).toBe(0)
    expect(pos.pendingSellFen).toBe(600)
    expect(pos.avgCost).toBe(100)
  })

  it('确认中买入在卖出到账前顺序正确', () => {
    const txns = [
      buy('2026-08-01', 100, 10), // 已确认
      sell('2026-08-11', 150, 10), // 未到账, 冻结全部 10 份
      buy('2026-08-11', 200, 5) // 确认中
    ]
    const pos = computePosition(txns, 1, '2026-08-11')
    expect(pos.quantity).toBe(10)
    expect(pos.frozenShares).toBe(10)
    expect(pos.pendingSellFen).toBe(1500)
    expect(pos.pendingBuyFen).toBe(1000)
  })
})

describe('settleDaysOf 解析', () => {
  it('显式配置优先', () => {
    expect(settleDaysOf({ settleDays: 2, symbol: '006260', type: 'etf', market: 'CN' })).toBe(2)
  })

  it('6 位基金代码无配置 → 1 (T+1)', () => {
    expect(settleDaysOf({ symbol: '006260', type: 'etf', market: 'CN' })).toBe(1)
  })

  it('CN 基金无配置 → 1', () => {
    expect(settleDaysOf({ symbol: 'ABC', type: 'bond', market: 'CN' })).toBe(1)
  })

  it('美股无配置 → 0 (即时, 存量行为零变化)', () => {
    expect(settleDaysOf({ symbol: 'QQQ', type: 'etf', market: 'US' })).toBe(0)
  })
})
