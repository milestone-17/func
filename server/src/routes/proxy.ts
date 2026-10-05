import { FastifyInstance } from 'fastify'
import { requireAuth } from '../plugins/auth'

/**
 * 行情代理接口 (服务端转发东财/Yahoo, 内存缓存)
 * 前端不再浏览器直连外部数据源
 */

interface CacheEntry {
  expiresAt: number
  value: unknown
}

const caches = new Map<string, CacheEntry>()

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = caches.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value as T
  const value = await loader()
  caches.set(key, { expiresAt: Date.now() + ttlMs, value })
  return value
}

const UT = 'fa5fd1943c7b386f172d6893dbfba10b'
const UA = { 'User-Agent': 'Mozilla/5.0 (func-server)' }

interface FundQuoteRow {
  code: string
  name: string
  nav: number
  isEstimate: boolean
  navDate: string
  source: string
}

/** 东财 FundMNFInfo 批量净值 (服务端 HTTP 直连, 非 JSONP) */
async function fetchFundQuotesFromEm(codes: string[]): Promise<FundQuoteRow[]> {
  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=${Math.max(100, codes.length)}&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=wxf&Fcodes=${codes.join(',')}`
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`东财基金接口 HTTP ${res.status}`)
  const json = (await res.json()) as { Datas?: Array<{ FCODE?: string; SHORTNAME?: string; PDATE?: string; NAV?: string | number; GSZ?: string | number }> }
  const rows: FundQuoteRow[] = []
  for (const d of json?.Datas || []) {
    const code = String(d.FCODE || '').trim()
    if (!/^\d{6}$/.test(code)) continue
    const nav = Number(d.NAV)
    const gsz = Number(d.GSZ)
    if (Number.isFinite(nav) && nav > 0) {
      rows.push({ code, name: String(d.SHORTNAME || ''), nav, isEstimate: false, navDate: String(d.PDATE || ''), source: 'fundMNFInfo' })
    } else if (Number.isFinite(gsz) && gsz > 0) {
      rows.push({ code, name: String(d.SHORTNAME || ''), nav: gsz, isEstimate: true, navDate: String(d.PDATE || ''), source: 'fundMNFInfo' })
    }
  }
  return rows
}

interface MonthlyBarDto { date: string; open: number; close: number; high: number; low: number }

/** 东财 push2his 月K (klt=103) */
async function fetchMonthlyFromEm(secid: string): Promise<MonthlyBarDto[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&klt=103&fqt=1&lmt=10000&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55&ut=${UT}`
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`东财月K HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { klines?: string[] } }
  const out: MonthlyBarDto[] = []
  for (const k of json?.data?.klines || []) {
    const p = k.split(',')
    const date = (p[0] || '').trim()
    const o = Number(p[1]), c = Number(p[2]), h = Number(p[3]), l = Number(p[4])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ![o, c, h, l].every(Number.isFinite)) continue
    out.push({ date, open: o, close: c, high: h, low: l })
  }
  return out
}

/** Yahoo chart 日K (美股/ETF 现价与周线; 服务器直连可能 429, 由缓存与前端兜底) */
async function fetchYahooChart(symbol: string, range: string, interval: string): Promise<Array<{ date: string; close: number }>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`)
  const json = (await res.json()) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> }
  }
  const result = json?.chart?.result?.[0]
  const ts = result?.timestamp || []
  const closes = result?.indicators?.quote?.[0]?.close || []
  const bars: Array<{ date: string; close: number }> = []
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i]
    if (c == null || Number.isNaN(c)) continue
    const d = new Date(ts[i] * 1000)
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    bars.push({ date, close: Math.round(c * 100) / 100 })
  }
  return bars
}

/** 腾讯美股日K兜底 (Yahoo 429 时用; 仅支持字母代码, 纳指100=usNDX 等指数代码另有映射) */
async function fetchTencentUsDaily(symbol: string): Promise<Array<{ date: string; close: number }>> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${encodeURIComponent(symbol.toLowerCase())},day,,,660,qfq`
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`腾讯 HTTP ${res.status}`)
  const json = await res.json()
  const data = (json as { data?: Record<string, { qfqday?: unknown[][]; day?: unknown[][] }> }).data || {}
  const node = Object.values(data)[0]
  const rows = node?.qfqday || node?.day || []
  const bars: Array<{ date: string; close: number }> = []
  for (const r of rows as unknown[][]) {
    if (!Array.isArray(r) || r.length < 3) continue
    const date = String(r[0] || '')
    const close = Number(r[2])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
    bars.push({ date, close })
  }
  return bars
}

export async function proxyRoutes(app: FastifyInstance): Promise<void> {
  // 基金净值批量 (60s 缓存)
  app.get('/api/market/fund-quotes', { preHandler: requireAuth }, async (req, reply) => {
    const { codes } = (req.query || {}) as { codes?: string }
    const list = (codes || '').split(',').map(c => c.trim()).filter(c => /^\d{6}$/.test(c)).slice(0, 50)
    if (!list.length) return reply.code(400).send({ error: 'codes 参数不合法' })
    try {
      const rows = await cached(`fund:${list.join(',')}`, 60_000, () => fetchFundQuotesFromEm(list))
      return { items: rows }
    } catch (e) {
      return reply.code(502).send({ error: `净值拉取失败: ${(e as Error).message}` })
    }
  })

  // 指数/股票 月K (12h 缓存)
  app.get('/api/market/monthly', { preHandler: requireAuth }, async (req, reply) => {
    const { secid } = (req.query || {}) as { secid?: string }
    if (!secid || !/^[01]\.\d{6}$/.test(secid)) return reply.code(400).send({ error: 'secid 参数不合法' })
    try {
      const bars = await cached(`monthly:${secid}`, 12 * 3600_000, () => fetchMonthlyFromEm(secid))
      return { bars }
    } catch (e) {
      return reply.code(502).send({ error: `月K拉取失败: ${(e as Error).message}` })
    }
  })

  // Yahoo 日K代理 (美股现价 5d / 周线 5ywk; 30m/12h 缓存降低 429 概率)
  app.get('/api/market/yahoo-daily', { preHandler: requireAuth }, async (req, reply) => {
    const { symbol, range = '5d', interval = '1d' } = (req.query || {}) as { symbol?: string; range?: string; interval?: string }
    if (!symbol || !/^[A-Za-z^0-9.\-]{1,12}$/.test(symbol)) return reply.code(400).send({ error: 'symbol 参数不合法' })
    if (!['5d', '1mo', '5y'].includes(range) || !['1d', '1wk'].includes(interval)) return reply.code(400).send({ error: 'range/interval 不合法' })
    const key = `yh:${symbol}:${range}:${interval}`
    const ttl = range === '5y' ? 12 * 3600_000 : 30 * 60_000
    try {
      const bars = await cached(key, ttl, () => fetchYahooChart(symbol, range, interval))
      return { bars }
    } catch (e1) {
      // Yahoo 429/失败 → 腾讯日K兜底 (等长序列, 周线由前端按 close 聚合的场景少; 腾讯仅日K)
      try {
        const bars = await cached(`tx:${key}`, ttl, () => fetchTencentUsDaily(symbol))
        if (bars.length > 0) return { bars }
        throw e1
      } catch {
        return reply.code(502).send({ error: `Yahoo 拉取失败: ${(e1 as Error).message}` })
      }
    }
  })
}
