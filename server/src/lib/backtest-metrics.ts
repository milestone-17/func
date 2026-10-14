/**
 * 回测引擎 · 指标层
 *
 * XIRR（货币加权年化收益率）、策略 A/B 通用指标（CoreMetrics）、三窗口切片、
 * 归一化净值曲线（画图用）与基准构造（普通定投 / 一次性买入，最小改动复用 runStrategyA）。
 */
import type { Bar } from './backtest-data'
import { runStrategyA } from './backtest-strategy-a'

// ---------------------------------------------------------------- XIRR

export interface CashFlow { date: string; amount: number }

function daysBetween(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.round((db - da) / 86400000)
}

/**
 * XIRR：货币加权年化收益率（年化小数，0.082 = 8.2%/年）。
 * 现金流符号约定（业界惯例）：投入为负、期末回收为正。
 * f(r) = Σ amount_i × (1+r)^(-days_i/365)，Newton 迭代求解（初值 0.1，最多 100 次）；
 * 空流 / 全部同号 / 导数接近 0 / 发散 / 不收敛 → NaN，由调用方转 null。
 */
export function xirr(flows: CashFlow[]): number {
  if (flows.length === 0) return NaN
  const t0 = flows.reduce((m, f) => (f.date < m ? f.date : m), flows[0].date)
  const terms = flows.map(f => ({ a: f.amount, t: daysBetween(t0, f.date) / 365 }))
  let hasPos = false
  let hasNeg = false
  for (const tm of terms) {
    if (tm.a > 0) hasPos = true
    else if (tm.a < 0) hasNeg = true
  }
  if (!hasPos || !hasNeg) return NaN

  let r = 0.1
  for (let iter = 0; iter < 100; iter++) {
    if (r <= -1) return NaN
    const p = 1 + r
    let f = 0
    let df = 0
    for (const tm of terms) {
      const g = Math.pow(p, -tm.t)
      f += tm.a * g
      if (tm.t > 0) df -= tm.t * tm.a * Math.pow(p, -tm.t - 1)
    }
    if (!Number.isFinite(f)) return NaN
    if (Math.abs(f) < 1e-10) return r
    if (Math.abs(df) < 1e-12) return NaN
    const step = f / df
    const rNext = r - step
    if (!Number.isFinite(rNext) || rNext <= -1 || Math.abs(rNext) > 10) return NaN
    if (Math.abs(rNext - r) < 1e-10) return rNext
    r = rNext
  }
  return NaN
}

// ---------------------------------------------------------------- 通用指标

export interface CoreMetrics {
  totalInvested: number
  endValue: number
  totalReturnPct: number      // (endValue - totalInvested) / totalInvested × 100
  xirrPct: number | null      // XIRR 年化 × 100（NaN → null）
  maxDrawdownPct: number      // wealth 序列峰谷最大回撤 × 100
  maxDrawdownMonths: number   // 回撤持续月数（从峰值月到收复月；未收复算到末尾）
  annualizedVolPct: number    // 月收益率标准差 × √12 × 100
  sharpe: number | null       // (年化收益 - 0.02) / 年化波动率；波动率 0 → null
  winRatePct: number          // 月度财富正增长月份占比 × 100
}

/** 从 monthly 序列构造 XIRR 现金流：每月增量投入取负；期末最后一天 +endValue 正流（利息已含在 wealth，无需单独流） */
function xirrFlowsFromMonthly(monthly: { date: string; invested: number; wealth: number }[]): CashFlow[] {
  const flows: CashFlow[] = []
  let prevInvested = 0
  for (const p of monthly) {
    const delta = p.invested - prevInvested
    if (delta > 1e-9) flows.push({ date: p.date, amount: -delta })
    prevInvested = p.invested
  }
  const last = monthly[monthly.length - 1]
  flows.push({ date: last.date, amount: last.wealth })
  return flows
}

/** 策略 A/B 通用指标 */
export function computeCoreMetrics(
  monthly: { date: string; invested?: number; wealth: number }[],
  totalInvested: number
): CoreMetrics {
  const n = monthly.length
  if (n === 0 || totalInvested <= 0) {
    return { totalInvested: 0, endValue: 0, totalReturnPct: 0, xirrPct: null, maxDrawdownPct: 0, maxDrawdownMonths: 0, annualizedVolPct: 0, sharpe: null, winRatePct: 0 }
  }

  const endValue = monthly[n - 1].wealth
  const totalReturnPct = (endValue - totalInvested) / totalInvested * 100

  // XIRR：优先用窗口内增量投入（切片窗口口径），缺 invested 字段时回退单笔流近似
  const hasInvested = monthly[0].invested !== undefined
  const flows = hasInvested
    ? xirrFlowsFromMonthly(monthly as { date: string; invested: number; wealth: number }[])
    : [{ date: monthly[0].date, amount: -totalInvested }, { date: monthly[n - 1].date, amount: endValue }]
  const x = xirr(flows)
  const xirrPct = Number.isFinite(x) ? x * 100 : null

  // 最大回撤 + 回撤持续月数（从峰值月到收复月；未收复算到末尾）
  let peak = monthly[0].wealth
  let peakIdx = 0
  let maxDd = 0
  let ddStartIdx = 0
  let maxDdMonths = 0
  for (let i = 1; i < n; i++) {
    const w = monthly[i].wealth
    if (w > peak) { peak = w; peakIdx = i }
    if (peak > 0) {
      const dd = (peak - w) / peak
      if (dd > maxDd) { maxDd = dd; ddStartIdx = peakIdx }
    }
  }
  if (maxDd > 0) {
    let troughIdx = ddStartIdx
    let tv = Infinity
    for (let i = ddStartIdx; i < n; i++) {
      if (monthly[i].wealth < tv) { tv = monthly[i].wealth; troughIdx = i }
    }
    let recovery = -1
    for (let i = troughIdx + 1; i < n; i++) {
      if (monthly[i].wealth >= peak) { recovery = i; break }
    }
    maxDdMonths = recovery >= 0 ? recovery - ddStartIdx : n - 1 - ddStartIdx
  }

  // 月收益率 → 年化波动率（样本标准差 × √12）与夏普
  const rets: number[] = []
  for (let i = 1; i < n; i++) {
    if (monthly[i - 1].wealth > 0) rets.push(monthly[i].wealth / monthly[i - 1].wealth - 1)
  }
  const m = rets.length
  let annualizedVolPct = 0
  let sharpe: number | null = null
  if (m > 1) {
    const mean = rets.reduce((a, b) => a + b, 0) / m
    const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (m - 1)
    const monthlyStd = Math.sqrt(variance)
    annualizedVolPct = monthlyStd * Math.sqrt(12) * 100
    if (annualizedVolPct > 0) {
      const annualizedReturn = mean * 12
      sharpe = (annualizedReturn - 0.02) / (annualizedVolPct / 100)
    }
  }

  // 胜率：月度财富正增长月份占比
  let wins = 0
  for (let i = 1; i < n; i++) {
    if (monthly[i].wealth > monthly[i - 1].wealth) wins++
  }
  const winRatePct = n > 1 ? wins / (n - 1) * 100 : 0

  return { totalInvested, endValue, totalReturnPct, xirrPct, maxDrawdownPct: maxDd * 100, maxDrawdownMonths: maxDdMonths, annualizedVolPct, sharpe, winRatePct }
}

// ---------------------------------------------------------------- 三窗口

export type WindowKey = 'y5' | 'y10' | 'full'

const WINDOW_POINTS: Record<WindowKey, number | null> = { y5: 60, y10: 120, full: null }

/** y5/y10 = 最近 60/120 个点；full = 全部；点数不足窗口长度返回空数组（调用方转 null 窗口） */
export function sliceMonthly<T extends { date: string }>(monthly: T[], window: WindowKey): T[] {
  const nPts = WINDOW_POINTS[window]
  if (nPts === null) return monthly
  if (monthly.length < nPts) return []
  return monthly.slice(monthly.length - nPts)
}

/** 窗口指标：investedAtWindowStart = 窗口首点前的累计 invested（窗口内投入 = 末 invested - 首 invested 前值） */
export function metricsForWindow(
  monthly: { date: string; invested: number; wealth: number }[],
  investedAtWindowStart: number,
  window: WindowKey
): CoreMetrics {
  const win = sliceMonthly(monthly, window)
  // 窗口内零投入（末累计投入未超过窗口前累计）→ 空指标
  if (win.length === 0 || win[win.length - 1].invested <= investedAtWindowStart) {
    return { totalInvested: 0, endValue: 0, totalReturnPct: 0, xirrPct: null, maxDrawdownPct: 0, maxDrawdownMonths: 0, annualizedVolPct: 0, sharpe: null, winRatePct: 0 }
  }
  const shifted = win.map(p => ({ date: p.date, invested: p.invested - investedAtWindowStart, wealth: p.wealth }))
  return computeCoreMetrics(shifted, shifted[shifted.length - 1].invested)
}

// ---------------------------------------------------------------- 归一化净值曲线

/** 各自除以首点 wealth 归一到 1.0，按日期对齐（两者 date 序列相同——同一标的模拟）。
 *  warmup 期 wealth=0 的前导点被跳过（除 0 无意义），以首个非零点为归一基准 */
export function normalizedCurve(
  monthly: { date: string; wealth: number }[],
  baseline: { date: string; wealth: number }[]
): { date: string; strategy: number; baseline: number }[] {
  const s0 = monthly.find(p => p.wealth > 0)?.wealth ?? 0
  const b0 = baseline.find(p => p.wealth > 0)?.wealth ?? 0
  if (s0 === 0 || b0 === 0) return []
  const out: { date: string; strategy: number; baseline: number }[] = []
  for (let i = 0; i < monthly.length; i++) {
    const b = baseline[i]
    if (!b || b.date !== monthly[i].date) break
    if (monthly[i].wealth <= 0 || b.wealth <= 0) continue
    out.push({
      date: monthly[i].date,
      strategy: monthly[i].wealth / s0,
      baseline: b.wealth / b0
    })
  }
  return out
}

// ---------------------------------------------------------------- 基准构造（普通定投 / 一次性买入）

export interface BenchmarkInput {
  bars: Bar[]                       // 日 K，升序
  currency?: 'CNY' | 'USD'
  fxByDate?: Map<string, number>    // USD 标的必传
  params: { monthlyAmount: number; feeRate: number; riskFreeAnnual: number }
}

/** 普通定投基准：与策略 A 相同的月末 4 点投入，但档位系数 k 恒为 1（无档位），返回与策略 A 同构的月度序列 */
export function runFixedDca(input: BenchmarkInput) {
  return runStrategyA({
    bars: input.bars,
    currency: input.currency ?? 'CNY',
    fxByDate: input.fxByDate ?? new Map<string, number>(),
    params: { ...input.params, mode: 'fixed' }
  })
}

/** 一次性买入基准：首个投入月月初全额买入（无费率差异：同 feeRate），返回与策略 A 同构的月度序列 */
export function runLumpSum(input: BenchmarkInput) {
  return runStrategyA({
    bars: input.bars,
    currency: input.currency ?? 'CNY',
    fxByDate: input.fxByDate ?? new Map<string, number>(),
    params: { ...input.params, mode: 'lumpsum' }
  })
}
