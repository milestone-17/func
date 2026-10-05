/**
 * 指数行情多源抓取 (腾讯主 → 东财备 → Yahoo 备)
 *
 * 指数映射:
 *   ^NDX  → 腾讯 usNDX (纳斯达克100) / 东财 100.NDX (综合指数, 口径不符仅兜底) / Yahoo ^NDX
 *   ^GSPC → 腾讯 usINX (标普500) / 东财 100.SPX / Yahoo ^GSPC
 * 输出统一: [{ symbol, date, data: {symbol,name,date,close} }] 并标注 source
 */

export type SourceId = 'tencent' | 'eastmoney' | 'yahoo'

export const SOURCE_LABELS: Record<SourceId, string> = {
  tencent: '腾讯',
  eastmoney: '东财',
  yahoo: 'Yahoo'
}

export const SOURCE_PRIORITY: SourceId[] = ['tencent', 'eastmoney', 'yahoo']

interface Bar { date: string; close: number }
export interface SourceResult {
  rows: Array<{ symbol: string; date: string; data: object }>
  source: SourceId
}

// ---------- 解析器 (纯函数, 可单测) ----------

/** 腾讯 newfqkline: {data:{usNDX:{qfqday:[[date,open,close,high,low,vol]]}}} */
export function parseTencentKlines(payload: unknown): Bar[] {
  const data = (payload as { data?: Record<string, { qfqday?: unknown; day?: unknown }> } | null)?.data
  if (!data || typeof data !== 'object') return []
  const keys = Object.keys(data)
  if (!keys.length) return []
  const node = data[keys[0]]
  const rows = (node?.qfqday || node?.day) as unknown
  if (!Array.isArray(rows)) return []
  const bars: Bar[] = []
  for (const r of rows as unknown[]) {
    if (!Array.isArray(r) || r.length < 3) continue
    const date = String(r[0] || '')
    const close = Number(r[2])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
    bars.push({ date, close: Math.round(close * 100) / 100 })
  }
  return bars
}

/** 东财 push2his klines: ["2026-01-05,open,close,high,low,..."] */
export function parseEmKlines(klines: unknown): Bar[] {
  if (!Array.isArray(klines)) return []
  const bars: Bar[] = []
  for (const k of klines) {
    if (typeof k !== 'string') continue
    const parts = k.split(',')
    const date = (parts[0] || '').trim()
    const close = Number(parts[2])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
    bars.push({ date, close: Math.round(close * 100) / 100 })
  }
  return bars
}

/** Yahoo chart: {chart:{result:[{timestamp,indicators.quote[0].close}]}} */
export function parseYahooBars(json: any): Bar[] {
  const result = json?.chart?.result?.[0]
  if (!result?.timestamp) return []
  const ts = result.timestamp as number[]
  const closes = result.indicators?.quote?.[0]?.close || []
  const bars: Bar[] = []
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i]
    if (c == null || Number.isNaN(c)) continue
    const d = new Date(ts[i] * 1000)
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    bars.push({ date, close: Math.round(c * 100) / 100 })
  }
  return bars
}

// ---------- 源定义 ----------

interface IndexDef { symbol: string; name: string }

const TENCENT_MAP: Record<string, string> = { '^NDX': 'usNDX', '^GSPC': 'usINX' }
const EM_MAP: Record<string, { secid: string; name: string }> = {
  '^NDX': { secid: '100.NDX', name: '纳斯达克综合指数(东财口径)' },
  '^GSPC': { secid: '100.SPX', name: '标普500指数' }
}
const YAHOO_MAP: Record<string, string> = { '^NDX': '^NDX', '^GSPC': '^GSPC' }

const UA = { 'User-Agent': 'Mozilla/5.0 (func-server)' }
const UT = 'fa5fd1943c7b386f172d6893dbfba10b'

async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fromTencent(def: IndexDef): Promise<Bar[]> {
  const code = TENCENT_MAP[def.symbol]
  if (!code) throw new Error(`腾讯不支持 ${def.symbol}`)
  const json = await fetchJson(`https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${code},day,,,660,qfq`)
  const bars = parseTencentKlines(json)
  if (bars.length < 400) throw new Error(`腾讯数据不足: ${bars.length}`)
  return bars
}

async function fromEastmoney(def: IndexDef): Promise<Bar[]> {
  const em = EM_MAP[def.symbol]
  if (!em) throw new Error(`东财不支持 ${def.symbol}`)
  const json = await fetchJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${em.secid}&klt=101&fqt=1&lmt=600&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55&ut=${UT}`)
  const bars = parseEmKlines(json?.data?.klines)
  if (bars.length < 400) throw new Error(`东财数据不足: ${bars.length}`)
  return bars
}

async function fromYahoo(def: IndexDef): Promise<Bar[]> {
  const ysym = YAHOO_MAP[def.symbol]
  if (!ysym) throw new Error(`Yahoo 不支持 ${def.symbol}`)
  const json = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?range=2y&interval=1d`)
  const bars = parseYahooBars(json)
  if (bars.length < 400) throw new Error(`Yahoo 数据不足: ${bars.length}`)
  return bars
}

const FETCHERS: Record<SourceId, (def: IndexDef) => Promise<Bar[]>> = {
  tencent: fromTencent,
  eastmoney: fromEastmoney,
  yahoo: fromYahoo
}

const NAMES: Record<string, string> = {
  '^NDX': '纳斯达克100指数',
  '^GSPC': '标普500指数'
}

const SYMBOLS: IndexDef[] = [
  { symbol: '^NDX', name: NAMES['^NDX'] },
  { symbol: '^GSPC', name: NAMES['^GSPC'] }
]

/**
 * 多源带兜底抓取: 按 priority 顺序尝试全部指数, 返回第一个成功源的全量结果。
 * 返回 null 表示全部源失败。
 */
export async function fetchWithFallback(priority: SourceId[] = SOURCE_PRIORITY): Promise<SourceResult | null> {
  for (const source of priority) {
    const fetcher = FETCHERS[source]
    if (!fetcher) continue
    let allOk = true
    const rows: Array<{ symbol: string; date: string; data: object }> = []
    for (const def of SYMBOLS) {
      try {
        const bars = await fetcher(def)
        const name = source === 'eastmoney' ? EM_MAP[def.symbol].name : def.name
        for (const b of bars) {
          rows.push({
            symbol: def.symbol,
            date: b.date,
            data: { symbol: def.symbol, name, date: b.date, close: b.close }
          })
        }
      } catch (e) {
        console.warn(`[market] ${source} ${def.symbol} 失败: ${(e as Error).message}`)
        allOk = false
        break
      }
    }
    if (allOk && rows.length > 0) return { rows, source }
  }
  return null
}

/** 兼容旧调用: 不带 source 标注 */
export async function fetchAllIndices(): Promise<Array<{ symbol: string; date: string; data: object }>> {
  const r = await fetchWithFallback()
  return r ? r.rows : []
}
