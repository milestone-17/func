/**
 * 回测引擎 · 策略 B 模拟模块
 *
 * 策略：顶底通道分区月度调仓（对齐前端 src/lib/indexChannel.ts 的 walk-forward 复刻）。
 * 日 K → CNY 计价 → 聚合月 K（每月取最后交易日收盘）→ 逐月末仅用 [0..t] 历史数据
 * 拟合顶底通道（±k 月分形枢轴 → Theil-Sen 中位数斜率 → 包络截距 + MAD 避雷针剔除），
 * 依当前点位 vs 通道三线判定四区：
 *   strong-buy → 投 monthlyBuyStrong；buy → 投 monthlyBuy；
 *   sell → 持有不动；strong-sell → 卖出持仓 25%（卖出所得回流现金池）。
 * 通道历史 < 60 月 / 枢轴不足 / lowConfidence → 当月 zone=null 只持有不动（现金照常计息）。
 * 现金池按年化 riskFreeAnnual 日复利（按相邻 bar 间隔的自然日天数）。
 * USD 标的：先按 close × fx 折算为 CNY 计价序列再聚月 K（份额即 CNY 计价份额）。
 */
import type { Bar } from './backtest-data'

export interface StrategyBParams {
  initialCash: number      // 期初现金，默认 100000
  monthlyBuyStrong: number // strong-buy 投入，默认 2000
  monthlyBuy: number       // buy 投入，默认 1000
  sellTrimPct: number      // strong-sell 减仓比例，默认 0.25
  feeRate: number          // 每笔费率 0.0005
  riskFreeAnnual: number   // 0.02
}

export interface StrategyBMonthlyPoint {
  date: string          // 月末交易日日期
  zone: string | null   // 'strong-buy' | 'buy' | 'sell' | 'strong-sell' | null（通道不可用时）
  cash: number          // 当月末现金余额
  units: number         // 当月末累计份额（CNY 计价）
  value: number         // 当月末持仓市值（CNY 计价）
  wealth: number        // value + cash
}

export interface StrategyBResult {
  totalInvested: number
  endValue: number
  cashEnd: number
  units: number
  monthly: StrategyBMonthlyPoint[]
  channelLowAtEnd: number | null   // 期末通道下轨（供前端比对）
  channelHighAtEnd: number | null  // 期末通道上轨（供前端比对）
}

export interface StrategyBInput {
  bars: Bar[]                      // 日 K，升序
  currency: 'CNY' | 'USD'          // 标的币种
  fxByDate: Map<string, number>    // USD 标的必传：date -> USDCNH 汇率
  params: StrategyBParams
}

// ---------------------------------------------------------------- 通道口径（与前端 indexChannel.ts 逐常量对齐）

/** 聚合月 K：收盘取当月最后交易日，max/minClose 为当月日收盘极值（枢轴用，均不引入未来数据） */
export interface MonthlyCloseBar { date: string; close: number; maxClose: number; minClose: number }
export interface PivotB { t: number; date: string; value: number }

export const PIVOT_WINDOW_K = 6          // 枢轴分形窗口 ±k 月 (k=6 ≈ 半年)
export const MAX_EXCLUDED_SPIKES = 2     // 顶线最多剔除的避雷针数
export const SPIKE_MAD_MULT = 3          // 残差离群阈值 = median + 3·MAD
export const MIN_PIVOTS = 6              // 单侧枢轴少于该数 → lowConfidence
export const MIN_MONTHS = 60             // 历史少于 5 年 → lowConfidence

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function dedupePivots(list: PivotB[], k: number, dir: 'more' | 'less'): PivotB[] {
  const out: PivotB[] = []
  for (const p of list) {
    const prev = out[out.length - 1]
    if (prev && p.t - prev.t < 2 * k) {
      // 间距过近: 保留更极端者
      const takeNew = dir === 'more' ? p.value > prev.value : p.value < prev.value
      if (takeNew) out[out.length - 1] = p
    } else {
      out.push(p)
    }
  }
  return out
}

/** Theil-Sen 中位数斜率 (对 ≤29% 离群点稳健); 点数 <2 返回 0 */
export function theilSenSlopeB(points: { t: number; value: number }[]): number {
  if (points.length < 2) return 0
  const slopes: number[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = points[j].t - points[i].t
      if (dt > 0) slopes.push((points[j].value - points[i].value) / dt)
    }
  }
  return median(slopes)
}

/**
 * walk-forward 通道拟合：仅使用 monthly[0..t]（含 t），供单测验证无未来函数。
 * 复刻前端 fitChannel：±k 月分形枢轴（末尾 k 根因右侧窗口不足不参与判定，与前端循环
 * 边界 i ∈ [k, n-1-k] 一致）→ 低点 Theil-Sen + 下包络截距(min)；高点初步 Theil-Sen →
 * 残差 MAD 离群剔除 ≤2 根避雷针 → 重拟合 + 上包络截距(max)。
 * lowConfidence：单侧枢轴 < MIN_PIVOTS 或历史 < MIN_MONTHS。
 */
export function fitChannelAt(monthly: MonthlyCloseBar[], t: number): { low: number; high: number; lowConfidence: boolean } {
  const highs = dedupePivots(
    monthly.slice(0, t + 1).map((b, i) => ({ t: i, date: b.date, value: b.maxClose })),
    PIVOT_WINDOW_K, 'more'
  )
  const lows = dedupePivots(
    monthly.slice(0, t + 1).map((b, i) => ({ t: i, date: b.date, value: b.minClose })),
    PIVOT_WINDOW_K, 'less'
  )
  // 复刻前端 findPivots 的 ±k 分形边界：末尾 k 根不参与枢轴判定
  const candHighs = highs.filter(p => p.t <= t - PIVOT_WINDOW_K)
  const candLows = lows.filter(p => p.t <= t - PIVOT_WINDOW_K)

  const lowConfidence = candHighs.length < MIN_PIVOTS || candLows.length < MIN_PIVOTS || t + 1 < MIN_MONTHS

  // 低线：Theil-Sen 斜率 + 下包络截距
  const bottomSlope = theilSenSlopeB(candLows)
  const bottomIntercept = candLows.length > 0 ? Math.min(...candLows.map(p => p.value - bottomSlope * p.t)) : 0

  // 顶线：初步拟合 → 残差 MAD 离群（避雷针）→ 剔除 ≤2 → 重拟合 + 上包络截距
  const slope0 = theilSenSlopeB(candHighs)
  const inter0 = median(candHighs.map(p => p.value - slope0 * p.t))
  const residuals = candHighs.map(p => p.value - (slope0 * p.t + inter0))
  const med = median(residuals)
  const absDev = residuals.map(r => Math.abs(r - med))
  const mad = median(absDev)
  const scale = mad > 0 ? mad : absDev.reduce((a, b) => a + b, 0) / Math.max(1, absDev.length)
  const spikeTs = new Set(
    candHighs
      .map((p, i) => ({ p, r: residuals[i] }))
      .filter(x => scale > 0 && x.r > med + SPIKE_MAD_MULT * scale)
      .sort((a, b) => b.r - a.r)
      .slice(0, MAX_EXCLUDED_SPIKES)
      .map(x => x.p.t)
  )
  const keptHighs = candHighs.filter(p => !spikeTs.has(p.t))
  const topSlope = theilSenSlopeB(keptHighs)
  const topIntercept = keptHighs.length > 0 ? Math.max(...keptHighs.map(p => p.value - topSlope * p.t)) : 0

  const low = bottomSlope * t + bottomIntercept
  const high = topSlope * t + topIntercept
  return { low, high, lowConfidence }
}

/** 偏离率 → 四区（阈值与前端 zoneOf 完全一致：下轨之下 strong-buy，下轨~中轨 buy，中轨~上轨 sell，上轨之上 strong-sell） */
export function zoneOfDev(dev: number): 'strong-buy' | 'buy' | 'sell' | 'strong-sell' {
  if (dev < 0) return 'strong-buy'
  if (dev < 0.5) return 'buy'
  if (dev < 1) return 'sell'
  return 'strong-sell'
}

// ---------------------------------------------------------------- 聚合与模拟

/** 两个 YYYY-MM-DD 日期之间的自然日天数 */
function daysBetween(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.round((db - da) / 86400000)
}

/** 日 K → 月 K：每月取最后交易日收盘；同时聚合当月日收盘极值（作为枢轴用月内 high/low，无未来数据） */
export function aggregateMonthly(bars: Bar[]): MonthlyCloseBar[] {
  const out: MonthlyCloseBar[] = []
  let cur: { month: string; close: number; maxClose: number; minClose: number; date: string } | null = null
  for (const b of bars) {
    const m = b.date.slice(0, 7)
    if (!cur || cur.month !== m) {
      if (cur) out.push({ date: cur.date, close: cur.close, maxClose: cur.maxClose, minClose: cur.minClose })
      cur = { month: m, close: b.close, maxClose: b.close, minClose: b.close, date: b.date }
    } else {
      cur.close = b.close
      cur.date = b.date
      if (b.close > cur.maxClose) cur.maxClose = b.close
      if (b.close < cur.minClose) cur.minClose = b.close
    }
  }
  if (cur) out.push({ date: cur.date, close: cur.close, maxClose: cur.maxClose, minClose: cur.minClose })
  return out
}

/** 策略 B 主模拟：通道分区月度调仓 + 现金池生息 */
export function runStrategyB(input: StrategyBInput): StrategyBResult {
  const { bars, currency, fxByDate, params } = input
  if (bars.length === 0) {
    return { totalInvested: 0, endValue: params.initialCash, cashEnd: params.initialCash, units: 0, monthly: [], channelLowAtEnd: null, channelHighAtEnd: null }
  }

  // CNY 计价日 K：USD 标的先按 close × fx 折算，后续全部 CNY 计价
  const cnyBars: Bar[] = bars.map(b => {
    if (currency === 'CNY') return b
    const fx = fxByDate.get(b.date) ?? 0
    return { date: b.date, close: b.close * fx }
  })

  const monthlyBars = aggregateMonthly(cnyBars)
  const { initialCash, monthlyBuyStrong, monthlyBuy, sellTrimPct, feeRate, riskFreeAnnual } = params

  // 月末交易日 → 日 K 索引映射（现金按日 bar 间隔计息，调仓动作在月末交易日执行）
  const lastDayIdxOfMonth = new Map<string, number>()
  let curMonth = ''
  for (let i = 0; i < cnyBars.length; i++) {
    const m = cnyBars[i].date.slice(0, 7)
    if (m !== curMonth) {
      if (curMonth !== '') lastDayIdxOfMonth.set(curMonth, i - 1)
      curMonth = m
    }
  }
  lastDayIdxOfMonth.set(curMonth, cnyBars.length - 1)

  let cash = initialCash
  let units = 0
  let totalInvested = 0
  const monthly: StrategyBMonthlyPoint[] = []
  let channelLowAtEnd: number | null = null
  let channelHighAtEnd: number | null = null

  let dayIdx = 0
  for (let m = 0; m < monthlyBars.length; m++) {
    const mb = monthlyBars[m]
    const endIdx = lastDayIdxOfMonth.get(mb.date.slice(0, 7)) ?? dayIdx - 1

    // 现金池按日 bar 间隔自然日数复利，推进到当月末
    while (dayIdx <= endIdx) {
      if (dayIdx > 0 && cash > 0) {
        const d = daysBetween(cnyBars[dayIdx - 1].date, cnyBars[dayIdx].date)
        if (d > 0) cash *= Math.pow(1 + riskFreeAnnual / 365, d)
      }
      dayIdx++
    }

    // walk-forward：仅用 [0..m] 拟合通道
    const fit = fitChannelAt(monthlyBars, m)
    if (m === monthlyBars.length - 1) {
      channelLowAtEnd = fit.lowConfidence ? null : fit.low
      channelHighAtEnd = fit.lowConfidence ? null : fit.high
    }

    let zone: string | null = null
    if (!fit.lowConfidence) {
      const close = mb.close
      const span = fit.high - fit.low
      const pos = span > 0 ? (close - fit.low) / span : 0.5
      zone = zoneOfDev(pos)
      if (zone === 'strong-buy' || zone === 'buy') {
        const want = zone === 'strong-buy' ? monthlyBuyStrong : monthlyBuy
        const amt = Math.min(want, Math.max(cash, 0)) // 现金不足投可用部分，不低于 0
        if (amt > 0) {
          const net = amt * (1 - feeRate)   // 净投入 = 金额 × (1 - feeRate)
          units += net / close
          totalInvested += amt
          cash -= amt
        }
      } else if (zone === 'strong-sell') {
        const trimUnits = units * sellTrimPct
        if (trimUnits > 0) {
          cash += trimUnits * close * (1 - feeRate)  // 卖出所得回流现金池
          units -= trimUnits
        }
      }
      // sell → 持有不动
    }

    const value = units * mb.close
    monthly.push({ date: mb.date, zone, cash, units, value, wealth: value + cash })
  }

  return {
    totalInvested,
    endValue: units * cnyBars[cnyBars.length - 1].close + cash,
    cashEnd: cash,
    units,
    monthly,
    channelLowAtEnd,
    channelHighAtEnd
  }
}
