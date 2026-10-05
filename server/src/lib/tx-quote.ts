/**
 * 腾讯行情月K解析: sh000001 月K → MonthlyBar[]
 *   响应: data.sh000001.month = [[日期,开,收,高,低,量], ...]
 */
import type { MonthlyBar } from './channel'
import { fetchQuoteJson } from './quote-fetch'

interface TxKlinePayload {
  data?: Record<string, { month?: unknown }> | null
}

/** 腾讯 fqkline 月K数组 → MonthlyBar[] (按日期升序) */
export function parseTencentKline(payload: unknown): MonthlyBar[] {
  const month = (payload as TxKlinePayload | null)?.data?.sh000001?.month
  if (!Array.isArray(month)) return []
  const out: MonthlyBar[] = []
  for (const row of month) {
    if (!Array.isArray(row)) continue
    const date = row[0]
    const open = Number(row[1])
    const close = Number(row[2])
    const high = Number(row[3])
    const low = Number(row[4])
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (![open, close, high, low].every(v => Number.isFinite(v) && v > 0)) continue
    out.push({ date, open, close, high, low })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** 上证指数月K: 腾讯行情 (320 根足够通道拟合) */
export async function fetchShMonthlyBarsTx(): Promise<MonthlyBar[]> {
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,month,,,320,qfq'
  const json = await fetchQuoteJson<TxKlinePayload>(url, 2)
  const bars = parseTencentKline(json)
  if (!bars.length) throw new Error('腾讯月K解析为空')
  return bars
}

// ---------------------------------------------------------------- 进程内缓存

let cachedBars: MonthlyBar[] | null = null
let cachedAt = 0
const CACHE_TTL = 6 * 3600_000 // 6 小时

/** 带缓存的上证月K (TTL 6h; 失败时回退过期缓存, 再失败才抛错) */
export async function getShMonthlyBars(): Promise<MonthlyBar[]> {
  const now = Date.now()
  if (cachedBars && now - cachedAt < CACHE_TTL) return cachedBars
  try {
    cachedBars = await fetchShMonthlyBarsTx()
    cachedAt = now
    return cachedBars
  } catch (e) {
    if (cachedBars) return cachedBars // 回退旧数据
    throw e
  }
}
