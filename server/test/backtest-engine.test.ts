import { describe, it, expect } from 'vitest'
import type { Bar } from '../src/lib/backtest-data'
import { fillForwardFx } from '../src/lib/backtest-data'
import { deviationOf, bucketOf, weekOfMonthOf, investDaysOf, runStrategyA } from '../src/lib/backtest-strategy-a'
import { fitChannelAt } from '../src/lib/backtest-strategy-b'
import type { MonthlyCloseBar } from '../src/lib/backtest-strategy-b'
import { xirr, sliceMonthly, metricsForWindow } from '../src/lib/backtest-metrics'

// ---------------------------------------------------------------- 纯构造数据 helper

/** 生成 count 个工作日日期（跳过周末），从 start(YYYY-MM-DD) 起 */
function bizDates(start: string, count: number): string[] {
  const out: string[] = []
  let t = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10))
  while (out.length < count) {
    const d = new Date(t)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10))
    t += 86400000
  }
  return out
}

/** 固定日增长率合成日 K：close = 100 × daily^i（默认 1300 根 ≈ 5 年，含 250 根 warmup） */
function growthBars(n = 1300, daily = 1.0002): Bar[] {
  return bizDates('2011-01-03', n).map((date, i) => ({
    date,
    close: Math.round(100 * Math.pow(daily, i) * 1e6) / 1e6
  }))
}

function closeOn(bars: Bar[], date: string): number {
  return bars.find(b => b.date === date)!.close
}

// ---------------------------------------------------------------- a. 档位对齐

describe('策略 A 档位表（闭-开区间，11 档）', () => {
  it('bucketOf: 边界值归桶与源码档位表一致', () => {
    // 高位边界用 >= 归高档
    expect(bucketOf(100)).toBe(0)       // [100,∞) → ×0
    expect(bucketOf(50)).toBe(0.1)      // [50,100) → ×0.1
    expect(bucketOf(15)).toBe(0.4)      // [15,50) → ×0.4
    expect(bucketOf(14.999)).toBe(0.7)  // (0,15) → ×0.7
    expect(bucketOf(0.0001)).toBe(0.7)
    expect(bucketOf(0)).toBe(1.0)       // 恰在 0 → 基准档 ×1.0
    // 低位边界用 > 归更低档：-5 不属于 (-5,0)
    expect(bucketOf(-0.0001)).toBe(1.3)
    expect(bucketOf(-5)).toBe(1.6)      // (-10,-5] → ×1.6
    expect(bucketOf(-10)).toBe(1.9)
    expect(bucketOf(-20)).toBe(2.2)
    expect(bucketOf(-30)).toBe(2.5)
    expect(bucketOf(-40)).toBe(2.8)     // (-40,-30] 之外 → 最深档 ×2.8
  })

  it('deviationOf: warmup 期返回 NaN，常数序列偏离率为 0，末日抬高 10% ≈ 10%', () => {
    const flat: Bar[] = bizDates('2011-01-03', 260).map(date => ({ date, close: 100 }))
    expect(Number.isNaN(deviationOf(flat, 248))).toBe(true) // i < 249 无 MA250
    expect(deviationOf(flat, 249)).toBe(0)
    const bumped = flat.map((b, i) => (i === 259 ? { ...b, close: 110 } : b))
    const dev = deviationOf(bumped, 259) // MA250 被微抬到 100.04 → dev ≈ 9.996%
    expect(dev).toBeGreaterThan(9.9)
    expect(dev).toBeLessThan(10)
  })
})

// ---------------------------------------------------------------- a2. 周桶划分（对齐前端 dcaWeek.weekOfMonth）

describe('weekOfMonthOf 周桶划分（日期 1-7/8-14/15-21/22-月末）', () => {
  it('桶边界与前端口径一致，个位日期不受字符位干扰', () => {
    expect(weekOfMonthOf('2026-01-01')).toBe(1)
    expect(weekOfMonthOf('2026-01-07')).toBe(1)
    expect(weekOfMonthOf('2026-01-08')).toBe(2)
    expect(weekOfMonthOf('2026-01-14')).toBe(2)
    expect(weekOfMonthOf('2026-01-15')).toBe(3)
    expect(weekOfMonthOf('2026-01-21')).toBe(3)
    expect(weekOfMonthOf('2026-01-22')).toBe(4)
    expect(weekOfMonthOf('2026-12-31')).toBe(4)
    expect(weekOfMonthOf('2026-02-06')).toBe(1)
    expect(weekOfMonthOf('2026-02-28')).toBe(4)
  })
})

// ---------------------------------------------------------------- b. XIRR 手算对照

describe('xirr 手算对照', () => {
  it('单期：2020-01-01 投 10000，一年后 11000（2020 闰年 366 天）→ r = 1.1^(365/366) - 1 ≈ 10%', () => {
    const r = xirr([
      { date: '2020-01-01', amount: -10000 },
      { date: '2021-01-01', amount: 11000 }
    ])
    expect(Math.abs(r - (Math.pow(1.1, 365 / 366) - 1))).toBeLessThan(1e-4)
  })

  it('两期投入：按 r=12% 正推期末值，反解应还原 12%（容差 1e-4）；全同号现金流返回 NaN', () => {
    const r2 = 0.12
    // 2020-01-01 → 2021-01-01 = 366 天；2020-07-01 → 2021-01-01 = 184 天
    const end = 10000 * Math.pow(1 + r2, 366 / 365) + 5000 * Math.pow(1 + r2, 184 / 365)
    const r = xirr([
      { date: '2020-01-01', amount: -10000 },
      { date: '2020-07-01', amount: -5000 },
      { date: '2021-01-01', amount: end }
    ])
    expect(Math.abs(r - r2)).toBeLessThan(1e-4)
    expect(Number.isNaN(xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: -2000 }
    ]))).toBe(true)
  })
})

// ---------------------------------------------------------------- c. walk-forward 无未来函数

describe('fitChannelAt walk-forward', () => {
  // 84 个月正弦+趋势合成月线
  const monthly: MonthlyCloseBar[] = []
  for (let t = 0; t < 84; t++) {
    const y = 2014 + Math.floor(t / 12)
    const m = String((t % 12) + 1).padStart(2, '0')
    const close = 100 + 0.5 * t + 8 * Math.sin((2 * Math.PI * t) / 20)
    monthly.push({ date: `${y}-${m}-28`, close, maxClose: close + 3, minClose: close - 3 })
  }

  it('截止第 N 月拟合与前 N 月切片拟合完全一致（N = 61/70/79）', () => {
    for (const N of [61, 70, 79]) {
      const atFull = fitChannelAt(monthly, N)
      const atSlice = fitChannelAt(monthly.slice(0, N + 1), N)
      expect(atFull).toEqual(atSlice)
      expect(Number.isFinite(atFull.low)).toBe(true)
      expect(Number.isFinite(atFull.high)).toBe(true)
    }
  })

  it('篡改 N 月之后的数据不影响第 N 月的拟合结果', () => {
    for (const N of [61, 70, 79]) {
      const mutated = monthly.map((p, i) =>
        i <= N ? p : { ...p, close: p.close * 100, maxClose: p.maxClose * 100, minClose: p.minClose * 100 }
      )
      expect(fitChannelAt(mutated, N)).toEqual(fitChannelAt(monthly, N))
    }
  })
})

// ---------------------------------------------------------------- d/e. 策略 A 合成日 K

describe('runStrategyA（匀速上涨合成日 K，偏离率恒 ≈2.5% → k=0.7）', () => {
  const bars = growthBars()

  it('费率生效：fee=0.003 的 endValue 严格低于 fee=0，且投入口径不变', () => {
    const noFee = runStrategyA({ bars, currency: 'CNY', fxByDate: new Map<string, number>(), params: { monthlyAmount: 1000, feeRate: 0, riskFreeAnnual: 0.02 } })
    const withFee = runStrategyA({ bars, currency: 'CNY', fxByDate: new Map<string, number>(), params: { monthlyAmount: 1000, feeRate: 0.003, riskFreeAnnual: 0.02 } })
    expect(noFee.totalInvested).toBeGreaterThan(0)
    expect(withFee.totalInvested).toBe(noFee.totalInvested)
    expect(withFee.endValue).toBeLessThan(noFee.endValue)
  })

  it('闲置现金计息：endValue = 持仓市值 + 现金余额，现金余额 > 未投本金（2% 年化利息）', () => {
    const res = runStrategyA({ bars, currency: 'CNY', fxByDate: new Map<string, number>(), params: { monthlyAmount: 1000, feeRate: 0, riskFreeAnnual: 0.02 } })
    const last = res.monthly[res.monthly.length - 1]
    expect(last.wealth).toBeCloseTo(last.value + last.cash, 6)
    expect(res.endValue).toBeCloseTo(last.wealth, 6)
    // k=0.7 → 每笔 30% 进现金池，未投本金 = 投入口径 × 0.3
    const cashPrincipal = res.totalInvested * 0.3
    expect(cashPrincipal).toBeGreaterThan(0)
    expect(res.cashEnd).toBeGreaterThan(cashPrincipal)            // 利息使其严格大于本金
    expect(res.cashEnd).toBeLessThan(cashPrincipal * 1.15)        // 约 4 年 2% 利息的合理上界
  })
})

// ---------------------------------------------------------------- d2. tiered 周桶投入日（产品口径核心断言）

describe('runStrategyA tiered 周桶投入日（每个周桶 1-7/8-14/15-21/22-月末 的最后一个交易日）', () => {
  // 注入节假日：使抽样月份的周桶末交易日落在非周五、单 bar 桶（2013-08 第 1 桶剩 08-01/02、第 3 桶仅剩 08-15）
  const HOLIDAYS = new Set([
    '2013-06-03', '2013-06-04',
    '2013-08-05', '2013-08-06', '2013-08-07', '2013-08-16',
    '2013-08-19', '2013-08-20', '2013-08-21', '2013-08-22', '2013-08-23',
    '2013-08-29', '2013-08-30'
  ])
  const bars: Bar[] = bizDates('2011-01-03', 1800)
    .filter(d => !HOLIDAYS.has(d))
    .map((date, i) => ({ date, close: Math.round(100 * Math.pow(1.0002, i) * 1e6) / 1e6 }))
  const res = runStrategyA({ bars, currency: 'CNY', fxByDate: new Map<string, number>(), params: { monthlyAmount: 1000, feeRate: 0, riskFreeAnnual: 0.02 } })
  const schedule = investDaysOf(bars)
  const warmupEndMonth = bars[249].date.slice(0, 7)

  it('抽样 3 个月：投入日恰为各周桶末交易日（经 investDaysOf 与月末份额增量双重核对）', () => {
    const cases: [string, string[]][] = [
      // 2013-04 无节假日：4 个周五 + 月末周二（22-30 桶）
      ['2013-04', ['2013-04-05', '2013-04-12', '2013-04-19', '2013-04-30']],
      // 2013-06 第 1 桶被假日削成 3 根（05/06/07），桶末日不变仍为 06-07
      ['2013-06', ['2013-06-07', '2013-06-14', '2013-06-21', '2013-06-28']],
      // 2013-08：第 1 桶剩 08-01/02，第 3 桶仅剩 08-15 一根，第 4 桶末为 08-28（29/30 假日）
      ['2013-08', ['2013-08-02', '2013-08-14', '2013-08-15', '2013-08-28']]
    ]
    for (const [month, expected] of cases) {
      const s = schedule.get(month)!
      expect(s.bucketLastDate.filter((d): d is string => d !== null)).toEqual(expected)
      // 引擎侧核对：该月月末 vs 上月月末的份额增量 = Σ 250×k/close(投入日)，k=0.7（匀速上涨）
      const pts = res.monthly
      const i = pts.findIndex(p => p.date.startsWith(month))
      expect(i).toBeGreaterThan(0)
      const expectedUnits = expected.reduce((sum, d) => sum + (1000 / 4) * 0.7 / closeOn(bars, d), 0)
      expect(pts[i].units - pts[i - 1].units).toBeCloseTo(expectedUnits, 6)
    }
  })

  it('投入日总数与调度一致（含残月剔除：投入月 > warmup 月且 >= 4 根 bar）', () => {
    let expectedDays = 0
    for (const [m, s] of schedule) {
      if (m > warmupEndMonth && s.tradingDays >= 4) expectedDays += s.bucketLastDate.filter(d => d !== null).length
    }
    expect(res.totalInvested).toBeCloseTo(250 * expectedDays, 6)
  })

  it('warmup 结束后第一个整月起投：warmup 月末投入为 0，首个投入月投入 = 250 × 非空桶数', () => {
    const jan = res.monthly.find(p => p.date.startsWith(warmupEndMonth))!
    expect(jan.invested).toBe(0)
    const nm = res.monthly.find(p => p.date.slice(0, 7) > warmupEndMonth)!
    const bucketDays = schedule.get(nm.date.slice(0, 7))!.bucketLastDate.filter((d): d is string => d !== null)
    expect(nm.invested).toBeCloseTo(250 * bucketDays.length, 6)
  })
})

// ---------------------------------------------------------------- d3. fixed 每日投入

describe('runStrategyA fixed 每日投入（日额 = 月额 ÷ 当月交易日数，k 恒 1）', () => {
  const bars = growthBars(1500)
  const res = runStrategyA({ bars, currency: 'CNY', fxByDate: new Map<string, number>(), params: { monthlyAmount: 1000, feeRate: 0, riskFreeAnnual: 0.02, mode: 'fixed' } })
  const warmupEndMonth = bars[249].date.slice(0, 7)

  it('warmup 后投入月数与逐日份额：总投入 = 月额 × 投入月数，总份额 = Σ(日额/close) 逐日累加', () => {
    let expectedUnits = 0
    let months = 0
    for (const [m, s] of investDaysOf(bars)) {
      if (m > warmupEndMonth && s.tradingDays >= 4) {
        months++
        for (let j = s.firstIdx; j <= s.lastIdx; j++) expectedUnits += (1000 / s.tradingDays) / bars[j].close
      }
    }
    expect(res.totalInvested).toBeCloseTo(1000 * months, 6)
    expect(res.totalUnits).toBeCloseTo(expectedUnits, 6)
  })

  it('任抽 1 个月：该月投入总额 ≈ monthlyAmount（容差 1 个日额）；warmup 月投入为 0、首个投入月投入恰为月额', () => {
    const pts = res.monthly
    const i = pts.findIndex(p => p.date.startsWith('2013-06'))
    const delta = pts[i].invested - pts[i - 1].invested
    expect(Math.abs(delta - 1000)).toBeLessThanOrEqual(1000 / 20) // 容差 1 个日额
    expect(delta).toBeCloseTo(1000, 6)                            // 浮动日额 × 交易日数精确还原月额
    const jan = pts.find(p => p.date.startsWith(warmupEndMonth))!
    expect(jan.invested).toBe(0)
    const feb = pts.find(p => p.date.slice(0, 7) > warmupEndMonth)!
    expect(feb.invested).toBeCloseTo(1000, 6)
  })

  it('k 恒 1：无闲置现金，endValue 全部为持仓', () => {
    expect(res.cashEnd).toBe(0)
    const last = res.monthly[res.monthly.length - 1]
    expect(last.cash).toBe(0)
    expect(last.wealth).toBeCloseTo(last.value, 6)
  })
})

// ---------------------------------------------------------------- d4. lumpsum 保持不变

describe('runStrategyA lumpsum（保持不变：首个投入月月初全额买入）', () => {
  const bars = growthBars(400)
  const res = runStrategyA({ bars, currency: 'CNY', fxByDate: new Map<string, number>(), params: { monthlyAmount: 1000, feeRate: 0, riskFreeAnnual: 0.02, mode: 'lumpsum' } })

  it('投入恰为一笔 12000，执行日 = warmup 后首月第 1 根 bar，此后不再投入', () => {
    const warmupEndMonth = bars[249].date.slice(0, 7)
    const [y, m] = warmupEndMonth.split('-').map(Number)
    const firstInvestMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    const day = bars.find(b => b.date.startsWith(firstInvestMonth))!
    const expectedUnits = 12000 / day.close
    expect(res.totalInvested).toBeCloseTo(12000, 6)
    expect(res.totalUnits).toBeCloseTo(expectedUnits, 6)
    expect(res.endValue).toBeCloseTo(expectedUnits * bars[bars.length - 1].close, 6)
    expect(res.cashEnd).toBe(0)
    expect(res.monthly[res.monthly.length - 1].invested).toBeCloseTo(12000, 6)
  })
})

// ---------------------------------------------------------------- f/g. 三窗口切片

describe('sliceMonthly / metricsForWindow 窗口', () => {
  const pts150 = Array.from({ length: 150 }, (_, i) => {
    const y = 2013 + Math.floor(i / 12)
    const m = String((i % 12) + 1).padStart(2, '0')
    return { date: `${y}-${m}-28`, invested: (i + 1) * 1000, wealth: (i + 1) * 1010 }
  })

  it('窗口不足：3 年数据请求 y5/y10 返回空，metricsForWindow 返回空指标；full 正常', () => {
    const pts36 = pts150.slice(0, 36)
    expect(sliceMonthly(pts36, 'y5')).toHaveLength(0)
    expect(sliceMonthly(pts36, 'y10')).toHaveLength(0)
    expect(sliceMonthly(pts36, 'full')).toHaveLength(36)
    const m5 = metricsForWindow(pts36, 0, 'y5')
    expect(m5.totalInvested).toBe(0)
    expect(m5.xirrPct).toBeNull()
    expect(m5.endValue).toBe(0)
    const mFull = metricsForWindow(pts36, 0, 'full')
    expect(mFull.totalInvested).toBe(36000)
    expect(mFull.endValue).toBe(36 * 1010)
  })

  it('边界：y5 恰好截取最近 60 个月，y10 恰好截取最近 120 个月', () => {
    const y5 = sliceMonthly(pts150, 'y5')
    expect(y5).toHaveLength(60)
    expect(y5[0].date).toBe('2020-07-28')        // 第 91 个点（i=90）
    expect(y5[y5.length - 1].date).toBe('2025-06-28')
    const y10 = sliceMonthly(pts150, 'y10')
    expect(y10).toHaveLength(120)
    expect(y10[0].date).toBe('2015-07-28')       // 第 31 个点（i=30）
    expect(y10[y10.length - 1].date).toBe('2025-06-28')
  })
})

// ---------------------------------------------------------------- f2. 窗口期末资产口径回归

describe('metricsForWindow 区间独立口径（期末资产与投入同步平移）', () => {
  // 每月投 1000，资产每月增 1010（稳定盈利）；覆盖 full / y10 / y5 三窗口
  const pts = Array.from({ length: 150 }, (_, i) => {
    const y = 2013 + Math.floor(i / 12)
    const m = String((i % 12) + 1).padStart(2, '0')
    return { date: `${y}-${m}-28`, invested: (i + 1) * 1000, wealth: (i + 1) * 1010 }
  })

  /** 按调用方口径取窗口首点前一个点的累计值 */
  function baseAt(points: { invested: number; wealth: number }[], nPts: number) {
    const idx = points.length - nPts - 1
    return idx >= 0
      ? { invested: points[idx].invested, wealth: points[idx].wealth }
      : { invested: 0, wealth: 0 }
  }

  it('切换区间时期末资产必须变化（回归：旧实现三窗口期末资产恒为全区间终值）', () => {
    const b10 = baseAt(pts, 120)
    const b5 = baseAt(pts, 60)

    const mFull = metricsForWindow(pts, 0, 'full', 0)
    const m10 = metricsForWindow(pts, b10.invested, 'y10', b10.wealth)
    const m5 = metricsForWindow(pts, b5.invested, 'y5', b5.wealth)

    // 三个窗口的期末资产互不相等（旧实现在这里会全部相等而失败）
    expect(m10.endValue).not.toBeCloseTo(mFull.endValue, 6)
    expect(m5.endValue).not.toBeCloseTo(m10.endValue, 6)
    expect(m5.endValue).not.toBeCloseTo(mFull.endValue, 6)

    // 且按窗口长度递减：y5 < y10 < full
    expect(m5.endValue).toBeLessThan(m10.endValue)
    expect(m10.endValue).toBeLessThan(mFull.endValue)
  })

  it('区间独立口径下 endValue 与 totalInvested 自洽', () => {
    const b10 = baseAt(pts, 120)
    const m10 = metricsForWindow(pts, b10.invested, 'y10', b10.wealth)

    const expectedInvested = pts[pts.length - 1].invested - b10.invested
    expect(m10.totalInvested).toBeCloseTo(expectedInvested, 6)
    expect(m10.totalInvested).toBeGreaterThan(0)

    const expectedEnd = pts[pts.length - 1].wealth - b10.wealth
    expect(m10.endValue).toBeCloseTo(expectedEnd, 6)

    expect(m10.totalReturnPct).toBeCloseTo((expectedEnd - expectedInvested) / expectedInvested * 100, 6)
  })

  it('未传 wealthAtWindowStart 时保持向后兼容（默认 0 = 旧语义）', () => {
    const b10 = baseAt(pts, 120)
    const legacy = metricsForWindow(pts, b10.invested, 'y10')
    const explicit = metricsForWindow(pts, b10.invested, 'y10', 0)
    expect(legacy.endValue).toBeCloseTo(explicit.endValue, 6)
  })
})

// ---------------------------------------------------------------- h. 汇率方向

describe('USD 标的汇率折算方向', () => {
  it('本币贬值（USDCNH 7→8）→ 持仓折 CNY 放大 8/7（正贡献）；升值（7→6）→ 6/7（负贡献）', () => {
    const bars = growthBars()
    const dates = bars.map(b => b.date)
    const params = { monthlyAmount: 1000, feeRate: 0, riskFreeAnnual: 0.02, mode: 'fixed' as const }
    const cny = runStrategyA({ bars, currency: 'CNY', fxByDate: new Map<string, number>(), params })
    expect(cny.cashEnd).toBe(0) // fixed 模式 k=1 → 无闲置现金，endValue 全部为持仓

    // 长期 7.0 买入，最后一日跳至 8.0
    const fxUp = fillForwardFx([{ date: dates[0], close: 7 }, { date: dates[dates.length - 1], close: 8 }], dates)
    const usdUp = runStrategyA({ bars, currency: 'USD', fxByDate: fxUp, params })
    expect(usdUp.cashEnd).toBeCloseTo(0, 6)
    expect(usdUp.endValue / cny.endValue).toBeCloseTo(8 / 7, 2)
    expect(usdUp.endValue).toBeGreaterThan(cny.endValue)

    // 对称：最后一日贬至 6.0
    const fxDown = fillForwardFx([{ date: dates[0], close: 7 }, { date: dates[dates.length - 1], close: 6 }], dates)
    const usdDown = runStrategyA({ bars, currency: 'USD', fxByDate: fxDown, params })
    expect(usdDown.endValue / cny.endValue).toBeCloseTo(6 / 7, 2)
    expect(usdDown.endValue).toBeLessThan(cny.endValue)
  })
})