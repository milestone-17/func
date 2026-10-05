/**
 * 指数顶底通道 (服务端移植, 与前端 src/lib/indexChannel.ts 同口径):
 *   枢轴检测 (±k 月分形) → Theil-Sen 中位数斜率 → 包络截距 + MAD 避雷针剔除
 *   Zone 四档: strong-buy / buy / sell / strong-sell
 */

export interface MonthlyBar { date: string; open: number; close: number; high: number; low: number }
export interface ChannelLine { slope: number; intercept: number; fromT: number; toT: number }
export interface PivotPoint { t: number; date: string; value: number }
export type Zone = 'strong-buy' | 'buy' | 'sell' | 'strong-sell'

export interface Channel {
  top: ChannelLine
  bottom: ChannelLine
  pivotHighs: PivotPoint[]
  pivotLows: PivotPoint[]
  excludedSpikes: PivotPoint[]
  lowConfidence: boolean
}

export const PIVOT_WINDOW_K = 6
export const MAX_EXCLUDED_SPIKES = 2
export const SPIKE_MAD_MULT = 3
export const MIN_PIVOTS = 6
export const MIN_MONTHS = 60

/** 解析 push2his K 线 JSON → MonthlyBar[] (升序); 非法行跳过 */
export function parsePush2hisKline(payload: unknown): MonthlyBar[] {
  const klines = (payload as { data?: { klines?: unknown } } | null)?.data?.klines
  if (!Array.isArray(klines)) return []
  const out: MonthlyBar[] = []
  for (const row of klines) {
    if (typeof row !== 'string') continue
    const parts = row.split(',')
    const date = parts[0]
    const open = Number(parts[1])
    const close = Number(parts[2])
    const high = Number(parts[3])
    const low = Number(parts[4])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (![open, close, high, low].every(v => Number.isFinite(v) && v > 0)) continue
    out.push({ date, open, close, high, low })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

function dedupePivots(list: PivotPoint[], k: number, dir: 'more' | 'less'): PivotPoint[] {
  const out: PivotPoint[] = []
  for (const p of list) {
    const prev = out[out.length - 1]
    if (prev && p.t - prev.t < 2 * k) {
      const takeNew = dir === 'more' ? p.value > prev.value : p.value < prev.value
      if (takeNew) out[out.length - 1] = p
    } else {
      out.push(p)
    }
  }
  return out
}

/** ±k 月分形极值检测; 同型枢轴间距 <2k 时保留更极端者 */
export function findPivots(bars: MonthlyBar[], k = PIVOT_WINDOW_K): { highs: PivotPoint[]; lows: PivotPoint[] } {
  const rawH: PivotPoint[] = []
  const rawL: PivotPoint[] = []
  for (let i = k; i < bars.length - k; i++) {
    let isH = true
    let isL = true
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue
      if (bars[j].high > bars[i].high) isH = false
      if (bars[j].low < bars[i].low) isL = false
      if (!isH && !isL) break
    }
    if (isH) rawH.push({ t: i, date: bars[i].date, value: bars[i].high })
    if (isL) rawL.push({ t: i, date: bars[i].date, value: bars[i].low })
  }
  return { highs: dedupePivots(rawH, k, 'more'), lows: dedupePivots(rawL, k, 'less') }
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Theil-Sen 中位数斜率; 点数 <2 返回 0 */
export function theilSenSlope(points: { t: number; value: number }[]): number {
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

/** 拟合顶底通道 (顶线剔避雷针后上包络; 低线下包络) */
export function fitChannel(bars: MonthlyBar[]): Channel {
  const { highs, lows } = findPivots(bars)
  const n = bars.length
  const tNow = n - 1
  const lowConfidence = highs.length < MIN_PIVOTS || lows.length < MIN_PIVOTS || n < MIN_MONTHS

  const bottomSlope = theilSenSlope(lows)
  const bottomIntercept = lows.length > 0 ? Math.min(...lows.map(p => p.value - bottomSlope * p.t)) : 0
  const bottom: ChannelLine = {
    slope: bottomSlope, intercept: bottomIntercept,
    fromT: lows.length > 0 ? Math.min(...lows.map(p => p.t)) : 0, toT: tNow
  }

  const slope0 = theilSenSlope(highs)
  const inter0 = median(highs.map(p => p.value - slope0 * p.t))
  const residuals = highs.map(p => p.value - (slope0 * p.t + inter0))
  const med = median(residuals)
  const absDev = residuals.map(r => Math.abs(r - med))
  const mad = median(absDev)
  const scale = mad > 0 ? mad : absDev.reduce((a, b) => a + b, 0) / Math.max(1, absDev.length)
  const spikeTs = new Set(
    highs
      .map((p, i) => ({ p, r: residuals[i] }))
      .filter(x => scale > 0 && x.r > med + SPIKE_MAD_MULT * scale)
      .sort((a, b) => b.r - a.r)
      .slice(0, MAX_EXCLUDED_SPIKES)
      .map(x => x.p.t)
  )
  const excludedSpikes = highs.filter(p => spikeTs.has(p.t))
  const cand = highs.filter(p => !spikeTs.has(p.t))
  const topSlope = theilSenSlope(cand)
  const topIntercept = cand.length > 0 ? Math.max(...cand.map(p => p.value - topSlope * p.t)) : 0
  const top: ChannelLine = {
    slope: topSlope, intercept: topIntercept,
    fromT: cand.length > 0 ? Math.min(...cand.map(p => p.t)) : 0, toT: tNow
  }

  return { top, bottom, pivotHighs: cand, pivotLows: lows, excludedSpikes, lowConfidence }
}

export interface ZoneInfo { zone: Zone; posPct: number; top: number; mid: number; bottom: number }

export const ZONE_LABELS: Record<Zone, string> = {
  'strong-buy': '重仓买入',
  'buy': '慢慢买',
  'sell': '慢慢卖',
  'strong-sell': '坚决卖'
}

/** 当前点位 vs 三线: 四区判定 + 通道内位置百分位 (低线 0%, 顶线 100%, 越界钳制) */
export function zoneOf(close: number, channel: Channel, tNow: number): ZoneInfo {
  const bottom = channel.bottom.slope * tNow + channel.bottom.intercept
  const top = channel.top.slope * tNow + channel.top.intercept
  const mid = (top + bottom) / 2
  const span = top - bottom
  const posPct = span > 0 ? Math.min(100, Math.max(0, ((close - bottom) / span) * 100)) : 50
  const zone: Zone = close < bottom ? 'strong-buy' : close < mid ? 'buy' : close < top ? 'sell' : 'strong-sell'
  return { zone, posPct, top, mid, bottom }
}
