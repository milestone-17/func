/**
 * 红利分数引擎单测: 纯函数直喂构造数据
 * 覆盖: 五因子评分边界 / 市场环境分 (利差分位、MA250 信号、三档 tier) / 样本池降级与 sampleCount
 */
import { describe, it, expect } from 'vitest'
import {
  pctileRank, scoreYield, scoreContinuity, scorePayout, scoreQuality, scoreLowVol,
  computeMarketEnv, selectPool, scoreStocks, buildDividendSnapshot,
  type Bar, type StockInput, type YieldPoint
} from '../src/lib/dividend-engine'

// ---------------------------------------------------------------- 工具

function stock(partial: Partial<StockInput> & { code: string }): StockInput {
  return {
    name: `股${partial.code}`, price: 10, marketCap: 1e10, amount: 1e8,
    divYield: 0.05, consecutiveYears: 5, payoutRatio: 0.4, roe: 10, volAnnualPct: 20,
    ...partial
  }
}

/** 生成 n 根日期连续的日K (closes 由生成器给出) */
function makeBars(n: number, closeAt: (i: number) => number): Bar[] {
  const out: Bar[] = []
  let t = Date.UTC(2020, 0, 6)
  let i = 0
  while (out.length < n) {
    const d = new Date(t)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const date = d.toISOString().slice(0, 10)
      out.push({ date, close: closeAt(i) })
      i++
    }
    t += 86400000
  }
  return out
}

function yieldsAligned(bars: Bar[], valueAt: (i: number) => number): YieldPoint[] {
  return bars.map((b, i) => ({ date: b.date, value: valueAt(i) }))
}

// ---------------------------------------------------------------- 分位数基础

describe('pctileRank 平均秩分位数', () => {
  it('空序列返回 null, 单样本返回 0.5 (中性)', () => {
    expect(pctileRank([], 3)).toBeNull()
    expect(pctileRank([5], 5)).toBe(0.5)
  })
  it('中位数 0.5, 区间端点单调', () => {
    expect(pctileRank([1, 2, 3], 2)).toBe(0.5)
    expect(pctileRank([1, 2, 3], 100)).toBe(1)
    expect(pctileRank([1, 2, 3], 0)).toBeLessThanOrEqual(1 / 6)
  })
})

// ---------------------------------------------------------------- 五因子

describe('因子1 股息率分 (30)', () => {
  const pool = [0.03, 0.04, 0.05, 0.06]
  it('池内分位 ×30, 缺失/非正为 0', () => {
    // 0.05: less=2, le=3 → 0.625 → 18.75
    expect(scoreYield(0.05, pool)).toBeCloseTo(18.75, 2)
    // 最高值 → 30
    expect(scoreYield(0.6, pool)).toBe(30)
    expect(scoreYield(null, pool)).toBe(0)
    expect(scoreYield(0, pool)).toBe(0)
    expect(scoreYield(-0.01, pool)).toBe(0)
  })
})

describe('因子2 分红连续性分 (25)', () => {
  it('≥5 年满分, 3~4 年线性, <3 年或缺失 0', () => {
    expect(scoreContinuity(null)).toBe(0)
    expect(scoreContinuity(2)).toBe(0)
    expect(scoreContinuity(3)).toBe(15)
    expect(scoreContinuity(4)).toBe(20)
    expect(scoreContinuity(5)).toBe(25)
    expect(scoreContinuity(9)).toBe(25)
  })
})

describe('因子3 派息率健康分 (20)', () => {
  it('10%~70% 满分; 70%~100% 线性递减; >100% 或 <10% 低分; 缺失 0', () => {
    expect(scorePayout(0.1)).toBe(20)
    expect(scorePayout(0.5)).toBe(20)
    expect(scorePayout(0.7)).toBe(20)
    // 0.85 → 20 × (1-0.85)/0.3 = 10
    expect(scorePayout(0.85)).toBe(10)
    expect(scorePayout(1.0)).toBe(0)
    expect(scorePayout(1.2)).toBe(10)
    expect(scorePayout(0.05)).toBe(10)
    expect(scorePayout(null)).toBe(0)
  })
})

describe('因子4 盈利质量分 (15)', () => {
  it('ROE>0 → 15×(0.3+0.7×分位); ROE≤0/缺失 0', () => {
    const pool = [5, 10]
    // roe=5: (0+1)/4=0.25 → 15×0.475=7.125
    expect(scoreQuality(5, pool)).toBeCloseTo(7.125, 2)
    // 最高 → 15
    expect(scoreQuality(50, pool)).toBe(15)
    expect(scoreQuality(null, pool)).toBe(0)
    expect(scoreQuality(0, pool)).toBe(0)
    expect(scoreQuality(-3, pool)).toBe(0)
  })
})

describe('因子5 低波动分 (10)', () => {
  it('波动率越低分越高 (池内最低→满分); 缺失中性 5; 空池中性 5', () => {
    const pool = [10, 20, 30]
    // 5 低于全部 → 分位 0 → 满分 10
    expect(scoreLowVol(5, pool)).toBe(10)
    // 15: less=1, le=1 → 2/6=0.333 → 6.67
    expect(scoreLowVol(15, pool)).toBeCloseTo(6.67, 2)
    // 20 恰为中位 → 5
    expect(scoreLowVol(20, pool)).toBe(5)
    expect(scoreLowVol(null, pool)).toBe(5)
    expect(scoreLowVol(15, [])).toBe(5)
  })
})

// ---------------------------------------------------------------- 市场环境

describe('computeMarketEnv', () => {
  it('利差分位最高 + 收盘>MA250 → 满仓信号, tier=适合投入', () => {
    // 收益率递减 → 利差 (4.6-y) 递增 → 最新利差为序列最大, 平均秩分位 = (2n-1)/2n ≈ 0.9981
    const bars = makeBars(260, i => 10 + i * 0.01)
    const ys = yieldsAligned(bars, i => 3 - i * 0.001)
    const m = computeMarketEnv(bars, ys)
    expect(m.spreadPctile).toBeCloseTo(0.9981, 3)
    expect(m.spreadScore).toBeCloseTo(99.81, 1)
    expect(m.ma250Signal).toBe(100)
    expect(m.marketScore).toBeCloseTo(99.89, 1)
    expect(m.tier).toBe('strong')
    expect(m.tierLabel).toBe('适合投入')
    expect(m.indexClose).toBeCloseTo(12.59, 1)
    expect(m.ma250).toBeLessThan(m.indexClose)
  })

  it('利差分位低但收盘>MA250 → 信号 100, tier=中性', () => {
    // 收益率递增 → 利差递减 → 最新利差为序列最小, 分位 ≈ 1/2n; 收盘线性上升 → > MA250
    const bars = makeBars(260, i => 10 + i * 0.01)
    const ys = yieldsAligned(bars, i => 2 + i * 0.001)
    const m = computeMarketEnv(bars, ys)
    expect(m.spreadPctile).toBeLessThan(0.6)
    expect(m.ma250Signal).toBe(100)
    // spreadScore≈0.19 → 0.19×0.6+100×0.4≈40.11 (恰好越过 40 阈值 → 中性)
    expect(m.marketScore).toBeCloseTo(40.11, 1)
    expect(m.tier).toBe('neutral')
    expect(m.tierLabel).toBe('中性')
  })

  it('利差分位低且收盘≤MA250 → 信号 0, tier=偏贵观望', () => {
    const bars = makeBars(260, () => 10)
    const ys = yieldsAligned(bars, i => 2 + i * 0.001)
    const m = computeMarketEnv(bars, ys)
    expect(m.ma250Signal).toBe(0)
    // close=10 = ma250 → 不满足收盘>MA250; spreadScore≈0.19 → 总分≈0.11
    expect(m.marketScore).toBeCloseTo(0.11, 1)
    expect(m.tier).toBe('cautious')
    expect(m.tierLabel).toBe('偏贵观望')
  })

  it('只在日期对齐处计算利差, 多余收益率点位被忽略; 空数据不崩', () => {
    const bars: Bar[] = [{ date: '2026-01-05', close: 100 }, { date: '2026-01-06', close: 101 }]
    const ys: YieldPoint[] = [
      { date: '2026-01-05', value: 2 }, { date: '2026-01-06', value: 3 },
      { date: '2026-01-07', value: 9 } // 非交易日, 应被忽略
    ]
    const m = computeMarketEnv(bars, ys)
    expect(m.indexClose).toBe(101)
    expect(m.spreadScore).toBeGreaterThan(0)
    const empty = computeMarketEnv([], [])
    expect(empty.indexClose).toBe(0)
    expect(empty.tier).toBe('cautious')
  })
})

// ---------------------------------------------------------------- 样本池与打分

describe('selectPool 样本池降级', () => {
  it('缺分红年数/不足3年/股息率缺失不入池, skippedCount 正确', () => {
    const cands = [
      stock({ code: '600001', divYield: 0.05, consecutiveYears: 5 }),
      stock({ code: '600002', divYield: 0.07, consecutiveYears: 3 }),
      stock({ code: '600003', divYield: 0.06, consecutiveYears: 2 }), // 不入池
      stock({ code: '600004', divYield: 0.04, consecutiveYears: null }), // 不入池
      stock({ code: '600005', divYield: null, consecutiveYears: 6 }) // 不入池
    ]
    const { pool, skippedCount } = selectPool(cands)
    expect(pool.map(s => s.code)).toEqual(['600002', '600001']) // 股息率降序
    expect(skippedCount).toBe(3)
  })

  it('样本超上限时只取股息率 Top100 (溢出属截断, 不计 skipped)', () => {
    const cands = Array.from({ length: 105 }, (_, i) =>
      stock({ code: `6001${String(i).padStart(3, '0')}`, divYield: 0.02 + i * 0.001, consecutiveYears: 4 }))
    const { pool, skippedCount } = selectPool(cands)
    expect(pool.length).toBe(100)
    expect(skippedCount).toBe(0)
    expect((pool[0] as StockInput).divYield).toBe(0.02 + 104 * 0.001)
  })
})

describe('scoreStocks 打分与排名', () => {
  it('totalScore = stockScore×0.8 + marketScore×0.2, rank 按 totalScore 降序', () => {
    const pool = [
      stock({ code: '600001', divYield: 0.05, consecutiveYears: 5, payoutRatio: 0.4, roe: 10, volAnnualPct: 15 }),
      stock({ code: '600002', divYield: 0.07, consecutiveYears: 3, payoutRatio: 1.2, roe: -2, volAnnualPct: 40 })
    ]
    const out = scoreStocks(pool, 50)
    expect(out.length).toBe(2)
    expect(out[0]!.rank).toBe(1)
    expect(out[1]!.rank).toBe(2)
    for (const s of out) {
      expect(s.totalScore).toBeCloseTo(s.stockScore * 0.8 + 50 * 0.2, 2)
      expect(s.stockScore).toBeGreaterThanOrEqual(0)
      expect(s.stockScore).toBeLessThanOrEqual(100)
    }
    // 第一名胜在连续分红/派息健康/盈利质量/低波动等因子
    expect(out[0]!.code).toBe('600001')
    expect(out[0]!.factors.yieldScore).toBeLessThan(out[1]!.factors.yieldScore)
    expect(out[0]!.factors.continuityScore).toBeGreaterThan(out[1]!.factors.continuityScore)
    expect(out[0]!.factors.qualityScore).toBeGreaterThan(out[1]!.factors.qualityScore)
  })

  it('单样本与空样本不崩', () => {
    expect(scoreStocks([], 50)).toEqual([])
    const single = scoreStocks([stock({ code: '600009' })], 0)
    expect(single.length).toBe(1)
    expect(single[0]!.rank).toBe(1)
  })
})

describe('buildDividendSnapshot 编排', () => {
  it('sampleCount/skippedCount/market/stocks 结构完整', () => {
    const cands = [
      stock({ code: '600001', divYield: 0.05, consecutiveYears: 5 }),
      stock({ code: '600003', divYield: 0.06, consecutiveYears: 1 }) // 跳过
    ]
    const bars = makeBars(260, i => 10 + i * 0.01)
    const ys = yieldsAligned(bars, i => 3 - i * 0.001)
    const snap = buildDividendSnapshot(cands, bars, ys, { notes: ['测试备注'] })
    expect(snap.sampleCount).toBe(1)
    expect(snap.skippedCount).toBe(1)
    expect(snap.notes).toEqual(['测试备注'])
    expect(snap.stocks.length).toBe(1)
    expect(snap.market.marketScore).toBeCloseTo(99.89, 1)
    expect(snap.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(snap.generatedAt).toBeTruthy()
  })
})
