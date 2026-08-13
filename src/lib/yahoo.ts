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

/** 读取打包进站点的预置行情 (同源, 必成功)。优先新结构 index-data.json, 旧结构降级 NDX */
export async function loadBundledQuotes(symbol: string = '^NDX'): Promise<BundledQuote | null> {
  // 1. 新结构: index-data.json { indices: { '^NDX': {...}, '^GSPC': {...} } }
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
  // 2. 旧结构降级: nasdaq-data.json 仅含 NDX
  if (symbol === '^NDX' || symbol === 'NDX') {
    try {
      const res = await fetch(`${BASE}nasdaq-data.json`, { cache: 'no-cache' })
      if (res.ok) return (await res.json()) as BundledQuote
    } catch { /* ignore */ }
  }
  return null
}

const NDX_CHART = (symbol: string) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`
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
 * 实时刷新指数行情: 尝试直连 + 代理链拉取 Yahoo。
 * 返回 bars 或 null (失败)。
 */
export async function fetchLiveQuotes(symbol: string = '^NDX'): Promise<{ date: string; close: number }[] | null> {
  const chart = NDX_CHART(symbol)
  const urls = [chart, ...PROXIES.map(p => p(chart))]
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

/** 持仓现价结果: price(元) + 是否估算值 */
export interface HoldingPrice {
  price: number
  isEstimate: boolean
}

/** 东财 push2 股票接口公开固定参数 (非密钥) */
const EASTMONEY_UT = 'fa5fd1943c7b386f172d6893dbfba10b'

/** fetch 带超时 (浏览器默认 fetch 无超时, 公共代理可能挂起, 阻塞批量刷新) */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { cache: 'no-cache', signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 东财 push2 拉取单只 A 股/ETF 现价 (元); 失败返回 null。基金代码返回空, 自然跳过 */
async function fetchStockQuoteFromPush2(symbol: string): Promise<number | null> {
  const secid = symbol.startsWith('6') ? `1.${symbol}` : `0.${symbol}`
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43&ut=${EASTMONEY_UT}`
  try {
    const res = await fetchWithTimeout(url, 6000)
    if (!res.ok) return null
    const j = await res.json()
    const v = j?.data?.f43
    if (typeof v === 'number' && v > 0) return v / 100
  } catch { /* 尽力, 失败返回 null */ }
  return null
}

/**
 * 按代码形态路由拉取单只持仓最新价 (元)。失败返回 null, 绝不抛出。
 * - 6 位数字代码: 中国基金/股票 → 先试基金 JSONP(东财移动端批量接口), 回落东财 push2 股票接口
 * - 字母代码(美股/ETF 如 QQQ): Yahoo 代理链
 * 任意新增代码自动适配对应源。
 */
export async function fetchHoldingPrice(market: string, symbol: string): Promise<HoldingPrice | null> {
  // 6 位数字: 基金 JSONP 优先, 回落股票接口
  if (/^\d{6}$/.test(symbol)) {
    const { fetchFundQuote } = await import('@/lib/fundQuote')
    const fund = await fetchFundQuote(symbol)
    if (fund && fund.nav > 0) return { price: fund.nav, isEstimate: fund.isEstimate }
    const stock = await fetchStockQuoteFromPush2(symbol)
    if (stock != null && stock > 0) return { price: stock, isEstimate: false }
    return null
  }
  // 字母代码: 美股/ETF → Yahoo 代理链
  if (market === 'US' || /[a-zA-Z]/.test(symbol)) {
    const p = await fetchLiveLatestPrice(symbol)
    return p != null && p > 0 ? { price: p, isEstimate: false } : null
  }
  // HK 等暂不支持自动拉取, 返回 null (调用方保留原值)
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
 * 批量拉取多只持仓现价: 6 位数字代码一次基金批量 JSONP, 未命中的 6 位代码回落 push2,
 * 字母代码走 Yahoo 代理链。单只失败不影响其他, 全部失败返回 null。
 */
export async function fetchHoldingPrices(
  holdings: { id: string; market: string; symbol: string }[]
): Promise<HoldingPriceResult[]> {
  const results: HoldingPriceResult[] = []
  const batched = new Set<string>()
  // 6 位数字代码 → 一次基金批量 JSONP
  const numericIds = holdings
    .filter(h => /^\d{6}$/.test(h.symbol))
    .map(h => ({ id: h.id, symbol: h.symbol }))
  if (numericIds.length > 0) {
    const { fetchFundNavs } = await import('@/lib/fundQuote')
    const fundMap = await fetchFundNavs(numericIds.map(h => h.symbol))
    for (const { id, symbol } of numericIds) {
      const f = fundMap.get(symbol)
      if (f) {
        results.push({ id, symbol, price: f.nav, isEstimate: f.isEstimate, navDate: f.navDate })
        batched.add(id)
      }
    }
  }
  // 未命中 → 逐只回落 (并行, 各自限时; 基金批量失败后的 6 位代码直接试 push2, 避免重复拉基金)
  const fallbacks = holdings
    .filter(h => !batched.has(h.id))
    .map(async h => {
      let price: number | null = null
      let isEstimate = false
      if (/^\d{6}$/.test(h.symbol)) {
        const stock = await fetchStockQuoteFromPush2(h.symbol)
        if (stock != null && stock > 0) price = stock
      } else if (h.market === 'US' || /[a-zA-Z]/.test(h.symbol)) {
        const p = await fetchLiveLatestPrice(h.symbol)
        if (p != null && p > 0) price = p
      }
      return { id: h.id, symbol: h.symbol, price, isEstimate, navDate: '' }
    })
  results.push(...(await Promise.all(fallbacks)))
  return results
}

/** 拉取单只美股最新收盘价 (用于持仓现价刷新; 浏览器里可能因 CORS 失败)。各源并行、各自限时 */
export async function fetchLiveLatestPrice(symbol: string): Promise<number | null> {
  const enc = encodeURIComponent(symbol)
  const direct = `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?range=5d&interval=1d`
  const urls = [direct, ...PROXIES.map(p => p(direct))]
  const attempts = urls.map(async url => {
    try {
      const res = await fetchWithTimeout(url, 4000)
      if (!res.ok) return null
      const json = await res.json()
      const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null && !Number.isNaN(closes[i])) return closes[i]
      }
      return null
    } catch {
      return null
    }
  })
  const settled = await Promise.all(attempts)
  return settled.find(v => v != null && v > 0) ?? null
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
