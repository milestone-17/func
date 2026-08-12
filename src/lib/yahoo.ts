/**
 * 行情数据加载 (同源优先, 避免浏览器 CORS)
 *
 * 策略:
 * 1. 主数据: 构建时抓取并打包进站点的 public/nasdaq-data.json (同源, 永不跨域)
 * 2. 实时刷新: 尝试通过公共 CORS 代理直连 Yahoo (可能失败, 失败则回落到主数据)
 *
 * 标的: ^NDX (纳斯达克100官方指数)
 */
import type { IndexData } from '@/types/dca'

export interface BundledQuote {
  symbol: string
  name?: string
  fetchedAt: number
  source: string
  count: number
  bars: { date: string; close: number }[]
}

const BASE = import.meta.env.BASE_URL || '/'
const INDEX_SYMBOL = '^NDX'

/** 读取打包进站点的预置行情 (同源, 必成功) */
export async function loadBundledQuotes(): Promise<BundledQuote | null> {
  try {
    const res = await fetch(`${BASE}nasdaq-data.json`, { cache: 'no-cache' })
    if (!res.ok) return null
    return (await res.json()) as BundledQuote
  } catch {
    return null
  }
}

const NDX_CHART = `https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?range=2y&interval=1d`
// 公共 CORS 代理链 (逐个尝试; 这些服务不稳定, 失败属正常)
const PROXIES = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u: string) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`
]

/** 解析 Yahoo chart JSON → bars */
export function parseYahooChart(json: any): { date: string; close: number }[] {
  const result = json?.chart?.result?.[0]
  if (!result?.timestamp) return []
  const ts = result.timestamp as number[]
  const closes = result.indicators?.quote?.[0]?.close || []
  const bars: { date: string; close: number }[] = []
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i]
    if (c == null || Number.isNaN(c)) continue
    const d = new Date(ts[i] * 1000)
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    bars.push({ date, close: Math.round(c * 100) / 100 })
  }
  return bars
}

/**
 * 实时刷新 NDX: 尝试直连 + 代理链拉取 Yahoo。
 * 返回 bars 或 null (失败)。
 */
export async function fetchLiveQuotes(): Promise<{ date: string; close: number }[] | null> {
  const urls = [NDX_CHART, ...PROXIES.map(p => p(NDX_CHART))]
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) continue
      const text = await res.text()
      const json = JSON.parse(text)
      const bars = parseYahooChart(json)
      if (bars.length >= 250) return bars
    } catch {
      // 试下一个
    }
  }
  return null
}

/** 拉取单只美股最新收盘价 (用于持仓现价刷新; 浏览器里可能因 CORS 失败) */
export async function fetchLiveLatestPrice(symbol: string): Promise<number | null> {
  const enc = encodeURIComponent(symbol)
  const direct = `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?range=5d&interval=1d`
  const urls = [direct, ...PROXIES.map(p => p(direct))]
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) continue
      const json = await res.json()
      const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null && !Number.isNaN(closes[i])) return closes[i]
      }
    } catch {
      // 试下一个
    }
  }
  return null
}

/** bars → IndexData 行 */
export function barsToIndexData(bars: { date: string; close: number }[], source: 'yahoo' | 'manual' | 'cache' = 'yahoo'): IndexData[] {
  return bars.map(b => ({
    symbol: INDEX_SYMBOL,
    date: b.date,
    close: b.close,
    ma250: null,
    source,
    fetchedAt: Date.now()
  }))
}
