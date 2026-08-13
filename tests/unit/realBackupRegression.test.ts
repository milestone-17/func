import { describe, it, expect } from 'vitest'
import { inferCategory } from '@/lib/category'
import { aggregateByType } from '@/lib/permanent'
import { yuanToFen } from '@/lib/money'
import type { HoldingCategory } from '@/types/portfolio'
// 真实备份数据回归: 用 func-backup-20260813-0907.json 的 16 只持仓 + 实测净值做端到端映射校验
import fixture from '../fixtures/backup-holdings-20260813.json'
const holdings: Array<{
  symbol: string; name: string; market: string; currency: string; type: string;
  quantity: number; avgCost: number; navYuan: number
}> = fixture.holdings

function effectiveCategory(h: { name: string; symbol: string; category?: string }): HoldingCategory {
  return (h.category ?? inferCategory(h.name, h.symbol)) as HoldingCategory
}

/** 有净值时的市值 (分): 净值(元)→分 × 份额; 备份中全部 CNY, 无需汇率换算 */
function marketValueFen(h: { navYuan: number; quantity: number }): number {
  return Math.round(yuanToFen(h.navYuan) * h.quantity)
}

const BOND_SYMBOLS = new Set(['016816', '019161', '001235'])
const OTHER_SYMBOLS = new Set(['017617', '007028', '027374'])

describe('真实备份数据回归 (16 只基金)', () => {
  it('自动分类: 债券→bond, 红利→dividend, 标普→sp500, 纳指→nasdaq100, 混合/中证500/恒生生科→other', () => {
    const cats = holdings.map(h => `${h.symbol}:${effectiveCategory(h)}`)
    expect(cats).toContain('016816:bond')
    expect(cats).toContain('019161:bond')
    expect(cats).toContain('001235:bond')
    expect(cats).toContain('006260:dividend')
    expect(cats).toContain('019261:dividend')
    expect(cats).toContain('008163:dividend')
    expect(cats).toContain('027748:dividend')
    expect(cats).toContain('017641:sp500')
    expect(cats).toContain('270042:nasdaq100')
    expect(cats).toContain('016452:nasdaq100')
    expect(cats).toContain('040046:nasdaq100')
    expect(cats).toContain('000834:nasdaq100')
    expect(cats).toContain('006479:nasdaq100')
    expect(cats).toContain('017617:other')
    expect(cats).toContain('007028:other')
    expect(cats).toContain('027374:other')
  })

  it('有净值 → 组合总市值>0; 债券基金计入债券而非股票, 其余(含 other-etf)计入股票', () => {
    const withMV = holdings.map(h => ({
      symbol: h.symbol,
      category: effectiveCategory(h),
      type: h.type,
      marketValueCNY: marketValueFen(h),
    }))
    const agg = aggregateByType(withMV)
    const expectedBond = withMV
      .filter(h => BOND_SYMBOLS.has(h.symbol))
      .reduce((s, h) => s + h.marketValueCNY, 0)
    const total = withMV.reduce((s, h) => s + h.marketValueCNY, 0)
    expect(total).toBeGreaterThan(0)
    expect(agg.bond).toBe(expectedBond)           // 债券基金归债券, 不误算进股票
    expect(agg.stock).toBe(total - expectedBond)  // 红利/纳指/标普 + other-etf → 股票
    expect(agg.cash).toBe(0)
    expect(agg.gold).toBe(0)
  })

  it('缺失分类经 inferCategory 兜底后聚合不丢、债券不为 0', () => {
    // 模拟 store refresh(): 所有持仓无已存分类 → category ?? inferCategory
    const withMV = holdings.map(h => ({
      symbol: h.symbol,
      category: effectiveCategory(h),
      type: h.type,
      marketValueCNY: marketValueFen(h),
    }))
    const agg = aggregateByType(withMV)
    const total = withMV.reduce((s, h) => s + h.marketValueCNY, 0)
    expect(agg.stock + agg.bond + agg.cash + agg.gold).toBe(total)
    expect(agg.bond).toBeGreaterThan(0)
    // 三只「其他」基金经 etf→stock 回退计入股票
    const otherMV = withMV.filter(h => OTHER_SYMBOLS.has(h.symbol)).reduce((s, h) => s + h.marketValueCNY, 0)
    expect(agg.stock).toBeGreaterThanOrEqual(otherMV)
  })
})
