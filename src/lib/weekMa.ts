/**
 * 周线状态 (20/30/60 周均线 线上/线下)
 *
 * 口径 (openspec/changes/add-fund-weekly-ma-status):
 * - 日频序列按 ISO 自然周重采样, 取每周最后一个有效值为该周收盘
 * - 周线 MA(N) = 最近 N 个周收盘的算术平均 (不足 N 周 → null = 数据不足)
 * - 判定基准 = 序列最新有效值; last >= MA 记 "线上", < MA 记 "线下"
 *
 * 数据路由 (与 fetchHoldingPrices 同哲学):
 * - 6 位数字: 服务端 /api/market/weekly 多源聚合 (场内东财/腾讯日K + 场外基金净值历史)
 * - 字母代码 (美股/ETF): Yahoo 周线 K 线 (已是周收盘, 不再重采样)
 * - 其余 (如港股): 暂不支持, 不发请求
 */
import { computeMA } from '@/lib/ma'
import { api } from '@/lib/api'
import { fetchWeeklyBars } from '@/lib/yahoo'

/** 周线周期 (周数) */
export const WEEK_MA_PERIODS = [20, 30, 60] as const
export type WeekMaPeriod = (typeof WEEK_MA_PERIODS)[number]

/** 线上 / 线下 / null(数据不足) */
export type WeekMaPosition = 'above' | 'below' | null

export interface WeekMaPeriodStatus {
  period: WeekMaPeriod
  ma: number | null
  position: WeekMaPosition
}

/** 单只持仓的周线状态行 (持久化到 meta['week-ma-snapshot']) */
export interface WeekMaRow {
  holdingId: string
  symbol: string
  name: string
  /** 判定基准: 最新净值/收盘价 (拉取失败为 null) */
  lastValue: number | null
  /** 周收盘数量 */
  weekCount: number
  statuses: WeekMaPeriodStatus[]
  fetchedAt: number
  /** 拉取失败原因 (单只失败不影响其余持仓) */
  error?: string
  /** 代码形态不支持 (如港股) */
  unsupported?: boolean
}

/** ISO 年-周键 "YYYY-Www" (周一为周首, 周四定年), 纯 UTC 计算不依赖本地时区; 非法日期返回 '' */
export function isoWeekKey(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.getUTCDay() // 0=周日 .. 6=周六
  // 本周四: ISO 年由周四所在年份决定 (周日属于本周末, 其周四在 3 天前)
  const isoDay = day === 0 ? 7 : day
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + (4 - isoDay))
  const year = thursday.getUTCFullYear()
  // 本周周一
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7))
  // ISO 第 1 周 = 包含 1 月 4 日的周
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7))
  const week = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

export interface WeeklyClose { weekKey: string; close: number }

/** 日频点按 ISO 周重采样: 每周取最后一个有效值, 结果按周键升序; 过滤非正值/非法值 */
export function resampleWeekly(points: { date: string; value: number }[]): WeeklyClose[] {
  const valid = points
    .filter(p => p && typeof p.date === 'string' && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  const byWeek = new Map<string, number>()
  for (const p of valid) {
    const key = isoWeekKey(p.date)
    if (key) byWeek.set(key, p.value) // 日期升序遍历, 后值覆盖前值 → 每周最后一个
  }
  return [...byWeek.entries()]
    .map(([weekKey, close]) => ({ weekKey, close }))
    .sort((a, b) => a.weekKey.localeCompare(b.weekKey))
}

/** 三档周线 MA 判定; 判定基准 = 数组末值 (last >= ma 记线上); 返回各档状态与周收盘数量 */
export function weekMaStatuses(weeklyCloses: number[]): { statuses: WeekMaPeriodStatus[]; weekCount: number } {
  const closes = weeklyCloses.filter(v => Number.isFinite(v) && v > 0)
  const weekCount = closes.length
  const last = weekCount > 0 ? closes[weekCount - 1] : null
  const statuses: WeekMaPeriodStatus[] = WEEK_MA_PERIODS.map(period => {
    const ma = computeMA(closes, period)
    let position: WeekMaPosition = null
    if (ma != null && last != null) position = last >= ma ? 'above' : 'below'
    return { period, ma, position }
  })
  return { statuses, weekCount }
}

/** 拉取单只持仓的周线状态行; 任何失败都落在 error/unsupported 字段, 不抛出 */
export async function fetchWeekMaRow(holding: { id: string; symbol: string; name: string }): Promise<WeekMaRow> {
  const base = { holdingId: holding.id, symbol: holding.symbol, name: holding.name, fetchedAt: Date.now() }
  const fail = (error: string): WeekMaRow => ({
    ...base, lastValue: null, weekCount: 0,
    statuses: weekMaStatuses([]).statuses, error
  })

  // 6 位数字: 服务端 /api/market/weekly 多源聚合 (场内东财/腾讯日K + 场外基金净值历史)
  if (/^\d{6}$/.test(holding.symbol)) {
    try {
      const r = await api.get<{ bars: Array<{ date: string; close: number }> }>(`/api/market/weekly?symbol=${encodeURIComponent(holding.symbol)}`)
      const bars = r.bars || []
      if (bars.length === 0) return fail('拉取失败')
      const { statuses, weekCount } = weekMaStatuses(bars.map(b => b.close))
      return { ...base, lastValue: bars[bars.length - 1].close, weekCount, statuses }
    } catch {
      return fail('拉取失败')
    }
  }

  // 字母代码: 美股/ETF 周线 K 线 (bars 即周收盘, 不再重采样)
  if (/[a-zA-Z]/.test(holding.symbol)) {
    try {
      const bars = await fetchWeeklyBars(holding.symbol)
      if (!bars || bars.length === 0) return fail('拉取失败')
      const { statuses, weekCount } = weekMaStatuses(bars.map(b => b.close))
      return { ...base, lastValue: bars[bars.length - 1].close, weekCount, statuses }
    } catch {
      return fail('拉取失败')
    }
  }

  // 其余 (如港股 00700): 暂不支持, 不发请求
  return { ...base, lastValue: null, weekCount: 0, statuses: weekMaStatuses([]).statuses, unsupported: true }
}
