/**
 * 行情数据加载 (云端版)
 *
 * 所有外部数据源请求一律经服务端代理 (/api/market/*), 浏览器不再直连:
 * - 指数日线: /api/market/index-data (cron 写库) — 见 indexDataRepo
 * - 美股/ETF 日K/周K: /api/market/yahoo-daily (服务端代理 Yahoo)
 * - 基金净值: /api/market/fund-quotes (服务端代理东财)
 * - A股/ETF 现价: /api/market/fund-quotes (6 位代码同源)
 * 兼容: 旧函数签名全部保留, 内部实现切换; 载入的 bundle JSON 仍作兜底。
 */
import { api } from '@/lib/api'
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

/** 读取打包进站点的预置行情 (同源兜底)。优先新结构 index-data.json, 旧结构降级 NDX */
export async function loadBundledQuotes(symbol: string = '^NDX'): Promise<BundledQuote | null> {
  try {
    const res = await fetch(`${BASE}index-data.json`, { cache: 'no-cache' })
    if (res.ok) {
      const data = await res.json()
      const entry = data?.indices?.[symbol]
      if (entry && Array.isArray(entry.bars) && entry.bars.length > 0) {
        return {
          symbol, name: entry.name, fetchedAt: entry.fetchedAt ?? Date.now(),
          source: entry.source ?? 'cache', count: entry.bars.length, bars: entry.bars
        }
      }
    }
  } catch { /* fall through to legacy */ }
  if (symbol === '^NDX' || symbol === 'NDX') {
    try {
      const res = await fetch(`${BASE}nasdaq-data.json`, { cache: 'no-cache' })
      if (res.ok) return (await res.json()) as BundledQuote
    } catch { /* ignore */ }
  }
  return null
}

/** 解析 Yahoo chart JSON → bars (保留导出, 测试仍在用) */
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

/** fetch 带超时 (导出供 indexChannel 复用) */
export async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { cache: 'no-cache', signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 实时刷新指数行情: 经服务端 Yahoo 代理 (2y 日K)。
 * 失败回落打包的 bundle 数据; 全部失败返回 null。
 */
export async function fetchLiveQuotes(symbol: string = '^NDX'): Promise<{ date: string; close: number }[] | null> {
  try {
    const r = await api.get<{ bars: { date: string; close: number }[] }>(
      `/api/market/yahoo-daily?symbol=${encodeURIComponent(symbol)}&range=5y&interval=1wk`
    )
    if (r.bars && r.bars.length >= 250) return r.bars
  } catch { /* fall through */ }
  try {
    const bundled = await loadBundledQuotes(symbol)
    return bundled && Array.isArray(bundled.bars) && bundled.bars.length > 0 ? bundled.bars : null
  } catch {
    return null
  }
}

/** 持仓现价结果: price(元) + 是否估算值 */
export interface HoldingPrice {
  price: number
  isEstimate: boolean
}

interface FundQuoteDto { code: string; name: string; nav: number; isEstimate: boolean; navDate: string; source: string }

/** 服务端基金净值批量代理 (60s 服务端缓存) */
export async function fetchFundQuotesApi(codes: string[]): Promise<Map<string, FundQuoteDto>> {
  const map = new Map<string, FundQuoteDto>()
  if (!codes.length) return map
  const r = await api.get<{ items: FundQuoteDto[] }>(`/api/market/fund-quotes?codes=${codes.join(',')}`)
  for (const row of r.items) map.set(row.code, row)
  return map
}

/** 东财 push2 拉取单只 A 股/ETF 现价 — 经服务端基金净值代理 (6 位代码), 6 位股票代码也走该接口兜底 */
async function fetchStockQuoteViaProxy(symbol: string): Promise<number | null> {
  try {
    const map = await fetchFundQuotesApi([symbol])
    const row = map.get(symbol)
    if (row && row.nav > 0) return row.nav
  } catch { /* 尽力 */ }
  return null
}

/**
 * 按代码形态路由拉取单只持仓最新价 (元)。失败返回 null, 绝不抛出。
 * - 6 位数字代码: 中国基金/股票 → 服务端净值代理
 * - 字母代码(美股/ETF 如 QQQ): 服务端 Yahoo 代理
 */
export async function fetchHoldingPrice(market: string, symbol: string): Promise<HoldingPrice | null> {
  if (/^\d{6}$/.test(symbol)) {
    const stock = await fetchStockQuoteViaProxy(symbol)
    if (stock != null && stock > 0) return { price: stock, isEstimate: false }
    return null
  }
  if (market === 'US' || /[a-zA-Z]/.test(symbol)) {
    const p = await fetchLiveLatestPrice(symbol)
    return p != null && p > 0 ? { price: p, isEstimate: false } : null
  }
  return null
}

/** 批量现价结果 (按持仓 id 归集; price 为元, null 表示失败) */
export interface HoldingPriceResult {
  id: string
  symbol: string
  price: number | null
  isEstimate: boolean
  navDate: string
}

/**
 * 批量拉取多只持仓现价: 6 位数字代码一次服务端基金批量代理, 字母代码走服务端 Yahoo 代理。
 * 单只失败不影响其他。
 */
export async function fetchHoldingPrices(
  holdings: { id: string; market: string; symbol: string }[]
): Promise<HoldingPriceResult[]> {
  const results: HoldingPriceResult[] = []
  const batched = new Set<string>()
  const numericIds = holdings
    .filter(h => /^\d{6}$/.test(h.symbol))
    .map(h => ({ id: h.id, symbol: h.symbol }))
  if (numericIds.length > 0) {
    try {
      const fundMap = await fetchFundQuotesApi(numericIds.map(h => h.symbol))
      for (const { id, symbol } of numericIds) {
        const f = fundMap.get(symbol)
        if (f) {
          results.push({ id, symbol, price: f.nav, isEstimate: f.isEstimate, navDate: f.navDate })
          batched.add(id)
        }
      }
    } catch { /* 逐只兜底 */ }
  }
  const fallbacks = holdings
    .filter(h => !batched.has(h.id))
    .map(async h => {
      let price: number | null = null
      const isEstimate = false
      if (/^\d{6}$/.test(h.symbol)) {
        price = await fetchStockQuoteViaProxy(h.symbol)
      } else if (h.market === 'US' || /[a-zA-Z]/.test(h.symbol)) {
        const p = await fetchLiveLatestPrice(h.symbol)
        if (p != null && p > 0) price = p
      }
      return { id: h.id, symbol: h.symbol, price, isEstimate, navDate: '' }
    })
  results.push(...(await Promise.all(fallbacks)))
  return results
}

/**
 * 拉取美股/ETF 周线收盘 (服务端 Yahoo 代理, range=5y&interval=1wk, 覆盖 60 周均线)。
 * 失败返回 null, 不抛。
 */
export async function fetchWeeklyBars(symbol: string, timeout = 10000): Promise<{ date: string; close: number }[] | null> {
  void timeout
  try {
    const r = await api.get<{ bars: { date: string; close: number }[] }>(
      `/api/market/yahoo-daily?symbol=${encodeURIComponent(symbol)}&range=5y&interval=1wk`
    )
    return r.bars.length > 0 ? r.bars : null
  } catch {
    return null
  }
}

/** 拉取单只美股最新收盘价 (服务端 Yahoo 代理 5d 日K, 服务端 30m 缓存) */
export async function fetchLiveLatestPrice(symbol: string): Promise<number | null> {
  try {
    const r = await api.get<{ bars: { date: string; close: number }[] }>(
      `/api/market/yahoo-daily?symbol=${encodeURIComponent(symbol)}&range=5d&interval=1d`
    )
    const bars = r.bars
    return bars.length ? bars[bars.length - 1].close : null
  } catch {
    return null
  }
}

/** bars → IndexData 行 */
export function barsToIndexData(bars: { date: string; close: number }[], source: 'yahoo' | 'manual' | 'cache' = 'yahoo', symbol: string = INDEX_SYMBOL): IndexData[] {
  return bars.map(b => ({
    symbol,
    date: b.date,
    close: b.close,
    ma250: null,
    source,
    fetchedAt: Date.now()
  }))
}
