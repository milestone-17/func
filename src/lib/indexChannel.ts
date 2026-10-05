/**
 * 指数顶底通道 (design.md D3 口径):
 *   枢轴检测 (±k 月分形) → Theil-Sen 中位数斜率 → 包络截距 + MAD 避雷针剔除
 *   - 低线 = 历年大底连线 (下包络, 各枢轴低点位于线上或上方)
 *   - 顶线 = 剔除避雷针尖峰后的大顶连线 (上包络, 尖刺穿线而上, 与参考图一致)
 *
 * 数据源 (2026-08-26 实测): push2his klt=103 月 K 支持 cb= JSONP 回调,
 * 返回 data.klines = ["YYYY-MM-DD,开,收,高,低", ...], 上证指数全量 ~432 根.
 */
import { api } from '@/lib/api'

export interface MonthlyBar { date: string; open: number; close: number; high: number; low: number }
export interface ChannelLine { slope: number; intercept: number; fromT: number; toT: number }
export interface PivotPoint { t: number; date: string; value: number }
export type Zone = 'strong-buy' | 'buy' | 'sell' | 'strong-sell'

export interface Channel {
  top: ChannelLine
  bottom: ChannelLine
  /** 参与顶线拟合的枢轴高点 (避雷针已剔除) */
  pivotHighs: PivotPoint[]
  pivotLows: PivotPoint[]
  /** 被剔除的避雷针尖峰 (≤ MAX_EXCLUDED_SPIKES) */
  excludedSpikes: PivotPoint[]
  /** 枢轴数/历史不足, 通道仅供参考 */
  lowConfidence: boolean
}

export interface PresetIndex { secid: string; name: string }

export const PRESET_INDICES: PresetIndex[] = [
  { secid: '1.000001', name: '上证指数' },
  { secid: '0.399001', name: '深证成指' },
  { secid: '1.000300', name: '沪深300' },
  { secid: '1.000905', name: '中证500' },
  { secid: '0.399006', name: '创业板指' },
  { secid: '1.000688', name: '科创50' },
]

/** 口径常量 (集中一处, 便于后续微调) */
export const PIVOT_WINDOW_K = 6          // 枢轴分形窗口 ±k 月 (k=6 ≈ 半年)
export const MAX_EXCLUDED_SPIKES = 2     // 顶线最多剔除的避雷针数
export const SPIKE_MAD_MULT = 3          // 残差离群阈值 = median + 3·MAD
export const MIN_PIVOTS = 6              // 单侧枢轴少于该数 → lowConfidence
export const MIN_MONTHS = 60             // 历史少于 5 年 → lowConfidence

// ---------------------------------------------------------------- 解析

/** 解析 push2his K 线 JSON → MonthlyBar[] (升序); 非法行跳过, 无数据返回 [] */
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

// ---------------------------------------------------------------- 枢轴

function dedupePivots(list: PivotPoint[], k: number, dir: 'more' | 'less'): PivotPoint[] {
  const out: PivotPoint[] = []
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

// ---------------------------------------------------------------- 拟合

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Theil-Sen 中位数斜率 (对 ≤29% 离群点稳健); 点数 <2 返回 0 */
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

/**
 * 拟合顶底通道。
 * 顶线: 初步 Theil-Sen → 残差 MAD 离群 → 剔除 ≤2 最大正残差(避雷针) → 重拟合 + 上包络截距
 * 低线: Theil-Sen 斜率 + 下包络截距 (不剔除)
 */
export function fitChannel(bars: MonthlyBar[]): Channel {
  const { highs, lows } = findPivots(bars)
  const n = bars.length
  const tNow = n - 1
  const lowConfidence = highs.length < MIN_PIVOTS || lows.length < MIN_PIVOTS || n < MIN_MONTHS

  // 低线
  const bottomSlope = theilSenSlope(lows)
  const bottomIntercept = lows.length > 0 ? Math.min(...lows.map(p => p.value - bottomSlope * p.t)) : 0
  const bottom: ChannelLine = {
    slope: bottomSlope, intercept: bottomIntercept,
    fromT: lows.length > 0 ? Math.min(...lows.map(p => p.t)) : 0, toT: tNow
  }

  // 顶线: 识别避雷针
  const slope0 = theilSenSlope(highs)
  const inter0 = median(highs.map(p => p.value - slope0 * p.t))
  const residuals = highs.map(p => p.value - (slope0 * p.t + inter0))
  const med = median(residuals)
  const absDev = residuals.map(r => Math.abs(r - med))
  const mad = median(absDev)
  // MAD=0 (过半点共线) 时用均值绝对偏差兜底, 保证存在尖峰时仍可识别
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

// ---------------------------------------------------------------- 区域

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

// ---------------------------------------------------------------- 拉取

/**
 * 拉取指数全量月 K: JSONP 优先 (实测可用), 失败回落 CORS 代理链 fetch。
 * 全部失败返回 null, 不抛。
 */
export async function fetchMonthlyBars(secid: string, timeout = 12000): Promise<MonthlyBar[] | null> {
  void timeout
  // 云端版: 经服务端代理 /api/market/monthly (12h 缓存), 浏览器不再直连东财
  try {
    const r = await api.get<{ bars: MonthlyBar[] }>(`/api/market/monthly?secid=${encodeURIComponent(secid)}`)
    return r.bars.length > 0 ? r.bars : null
  } catch {
    return null
  }
}
