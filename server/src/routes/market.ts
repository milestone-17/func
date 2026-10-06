import { FastifyInstance } from 'fastify'
import { requireAuth } from '../plugins/auth'
import { prisma } from '../lib/prisma'
import { fetchFundHistoryFromEm, searchFundsFromEm } from '../lib/fund-history'

export async function marketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/market/index-data', async (_req, reply) => {
    const rows = await prisma.indexData.findMany({ orderBy: { date: 'asc' } })
    reply.header('cache-control', 'public, max-age=300')
    const bySymbol: Record<string, { bars: Array<{ date: string; close: number }>; latest?: object; source?: string }> = {}
    for (const r of rows) {
      const d = r.data as { symbol: string; name?: string; date: string; close: number; source?: string }
      if (!bySymbol[d.symbol]) bySymbol[d.symbol] = { bars: [] }
      bySymbol[d.symbol].bars.push({ date: d.date, close: d.close })
      bySymbol[d.symbol].latest = d
      bySymbol[d.symbol].source = (d as { source?: string }).source || 'tencent'
    }
    return { indices: bySymbol }
  })

  app.get('/api/market/:symbol', async (req, reply) => {
    const { symbol } = req.params as { symbol: string }
    const rows = await prisma.indexData.findMany({
      where: { symbol },
      orderBy: { date: 'asc' }
    })
    reply.header('cache-control', 'public, max-age=300')
    return { symbol, bars: rows.map(r => (r.data as { date: string; close: number })) }
  })

  // 基金搜索 (东财 FundSearchAPI 代理)
  app.get('/api/market/fund-search', async (req, reply) => {
    const { key } = (req.query || {}) as { key?: string }
    if (!key || key.trim().length < 2) return reply.code(400).send({ error: '关键词至少 2 字符' })
    try {
      const items = await searchFundsFromEm(key.trim())
      return { items }
    } catch (e) {
      return reply.code(502).send({ error: `搜索失败: ${(e as Error).message}` })
    }
  })

  // 基金历史净值 (东财 f10/lsjz 代理 + fund_nav_history 缓存/增量)
  app.get('/api/market/fund-history', async (req, reply) => {
    const { code, days } = (req.query || {}) as { code?: string; days?: string }
    if (!code || !/^\d{6}$/.test(code)) return reply.code(400).send({ error: 'code 参数不合法' })
    const wantDays = Math.min(Math.max(Number(days) || 500, 100), 2000)
    try {
      const bars = await getCachedFundHistory(code, wantDays)
      reply.header('cache-control', 'public, max-age=600')
      return { code, bars, latest: bars.length ? bars[bars.length - 1] : null }
    } catch (e) {
      return reply.code(502).send({ error: `净值历史获取失败: ${(e as Error).message}` })
    }
  })

  // OHLC 日K (自选/持仓 K 线图用): 场内 6 位 → 东财日K全量OHLC → 腾讯兜底; 场外基金 → 净值历史降级单值蜡烛
  app.get('/api/market/kline', { preHandler: requireAuth }, async (req, reply) => {
    const { symbol, period } = (req.query || {}) as { symbol?: string; period?: string }
    if (!symbol || !/^\d{6}$/.test(symbol)) return reply.code(400).send({ error: 'symbol 参数不合法' })
    if (period && !['day', 'week', 'month'].includes(period)) return reply.code(400).send({ error: 'period 参数不合法' })
    const code = symbol
    const aggPeriod = (period || 'day') as 'day' | 'week' | 'month'
    try {
      const ohlc = await fetchEmOhlcCn(code).catch(() => [] as KlineBar[])
      let bars = ohlc.length > 0 ? ohlc : await fetchTxOhlcCn(code).catch(() => [] as KlineBar[])
      let kind: 'ohlc' | 'nav' = ohlc.length > 0 ? 'ohlc' : (bars.length > 0 ? 'ohlc' : 'nav')
      if (bars.length === 0) {
        // 场外基金: 无盘口价, 净值序列降级为单值蜡烛 (open=high=low=close=nav)
        const navs = await getCachedFundHistory(code, 500).catch(() => [])
        bars = navs.map(b => ({ date: b.date, open: b.nav, high: b.nav, low: b.nav, close: b.nav, volume: 0 }))
        kind = 'nav'
      }
      reply.header('cache-control', 'public, max-age=300')
      return { symbol: code, kind, period: aggPeriod, bars: aggregateBars(bars, aggPeriod) }
    } catch (e) {
      return reply.code(502).send({ error: `K线获取失败: ${(e as Error).message}` })
    }
  })

  // 周线聚合 (服务端日K → 周收盘; 美股持仓周MA用, 不再依赖 Yahoo 周线)
  app.get('/api/market/weekly', async (req, reply) => {
    const { symbol } = (req.query || {}) as { symbol?: string }
    if (!symbol || !/^[A-Za-z^0-9.\-]{1,12}$/.test(symbol)) return reply.code(400).send({ error: 'symbol 参数不合法' })
    try {
      const bars = await getWeeklyBars(symbol)
      return { bars }
    } catch (e) {
      return reply.code(502).send({ error: `周线聚合失败: ${(e as Error).message}` })
    }
  })
}

// ---------- 基金历史缓存 (内存 10min + DB 增量) ----------

interface FundBar { date: string; nav: number; accNav?: number }
const fundHistCache = new Map<string, { expiresAt: number; bars: FundBar[] }>()

async function getCachedFundHistory(code: string, days: number): Promise<FundBar[]> {
  const hit = fundHistCache.get(code)
  if (hit && hit.expiresAt > Date.now() && hit.bars.length >= days) {
    return hit.bars.slice(-days)
  }
  // DB 有多少
  const dbRows = await prisma.fundNavHistory.findMany({
    where: { code },
    orderBy: { date: 'asc' },
    take: 2000
  })
  let bars: FundBar[] = dbRows.map(r => ({ date: r.date, nav: r.nav, accNav: r.accNav ?? undefined }))
  // 最新日期不足请求天数或明显过期 (T-1 净值场景: 落后 ≥2 天才回源, 避免白天反复全量拉取)
  const latest = bars.length ? bars[bars.length - 1].date : ''
  const today = new Date().toISOString().slice(0, 10)
  const staleDays = latest ? Math.floor((Date.parse(today) - Date.parse(latest)) / 86400_000) : Infinity
  if (bars.length < days || staleDays >= 2) {
    const fetched = await fetchFundHistoryFromEm(code)
    if (fetched.length > bars.length) {
      // 只 upsert 库里没有的行 (增量, 避免每次全量写)
      const known = new Set(dbRows.map(r => r.date))
      const fresh = fetched.filter(b => !known.has(b.date))
      for (const b of fresh) {
        await prisma.fundNavHistory.upsert({
          where: { code_date: { code, date: b.date } },
          create: { code, date: b.date, nav: b.nav, accNav: b.accNav ?? null },
          update: { nav: b.nav, accNav: b.accNav ?? null }
        })
      }
      bars = fetched
    }
  }
  if (bars.length === 0) throw new Error('无数据')
  fundHistCache.set(code, { expiresAt: Date.now() + 10 * 60_000, bars })
  return bars.slice(-days)
}

// ---------- 周线聚合 ----------

const weeklyCache = new Map<string, { expiresAt: number; bars: Array<{ date: string; close: number }> }>()

async function getWeeklyBars(symbol: string): Promise<Array<{ date: string; close: number }>> {
  const hit = weeklyCache.get(symbol)
  if (hit && hit.expiresAt > Date.now()) return hit.bars
  // 1) 预置指数: 用库内日K聚合
  const dbRows = await prisma.indexData.findMany({ where: { symbol }, orderBy: { date: 'asc' } })
  let daily: Array<{ date: string; close: number }> = dbRows.map(r => {
    const d = r.data as { date: string; close: number }
    return { date: d.date, close: d.close }
  })
  // 2) 6 位数字代码: A股场内 (东财日K → 腾讯日K) → 场外基金 (天天基金净值历史)
  if (daily.length < 130 && /^\d{6}$/.test(symbol)) {
    daily = await fetchEmDailyCn(symbol).catch(() => [])
    if (daily.length < 130) daily = await fetchTxDailyCn(symbol).catch(() => [])
    if (daily.length < 130) {
      // 场外基金: 净值序列当收盘价聚合周线
      const navs = await getCachedFundHistory(symbol, 500).catch(() => [])
      daily = navs.map(b => ({ date: b.date, close: b.nav }))
    }
  }
  // 3) 无库数据的美股: Yahoo 日K → 腾讯兜底
  if (daily.length < 130) {
    const { fetchYahooChart, fetchTencentUsDaily } = await import('../routes/proxy')
    daily = await fetchYahooChart(symbol, '2y', '1d').catch(() => fetchTencentUsDaily(symbol))
  }
  if (daily.length < 130) throw new Error('日K数据不足, 无法聚合周线')
  const bars = aggregateWeekly(daily)
  weeklyCache.set(symbol, { expiresAt: Date.now() + 6 * 3600_000, bars })
  return bars
}

/** 东财 A股/ETF 日K (secid: 沪 6/5 开头, 深 0/1/3 开头) */
/** OHLC 日K 单根 */
interface KlineBar { date: string; open: number; high: number; low: number; close: number; volume: number }

/** 日K → 周/月K 聚合 (开=首根开, 收=末根收, 高低取极值, 量求和) */
function weekKeyOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - dow + 1) // 所在周周一
  return d.toISOString().slice(0, 10)
}
function aggregateBars(bars: KlineBar[], period: 'day' | 'week' | 'month'): KlineBar[] {
  if (period === 'day' || bars.length === 0) return bars
  const keyOf = period === 'month' ? (dt: string) => dt.slice(0, 7) : weekKeyOf
  const out: KlineBar[] = []
  let cur: KlineBar | null = null
  let curKey = ''
  for (const b of bars) {
    const k = keyOf(b.date)
    if (!cur || k !== curKey) {
      if (cur) out.push(cur)
      cur = { ...b }
      curKey = k
    } else {
      cur.high = Math.max(cur.high, b.high)
      cur.low = Math.min(cur.low, b.low)
      cur.close = b.close
      cur.volume += b.volume
    }
  }
  if (cur) out.push(cur)
  return out
}

/** 东财日K全量 OHLC (push2his klt=101 fqt=1; fields2 f51日期 f52开 f53收 f54高 f55低) */
async function fetchEmOhlcCn(code: string): Promise<KlineBar[]> {
  const market = /^[56]/.test(code) ? '1' : '0'
  const secid = `${market}.${code}`
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=500&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&ut=fa5fd1943c7b386f172d6893dbfba10b`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (func-server)' } })
  if (!res.ok) throw new Error(`东财OHLC HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { klines?: string[] } }
  const out: KlineBar[] = []
  for (const k of json?.data?.klines || []) {
    const p = k.split(',')
    const date = (p[0] || '').trim()
    const open = Number(p[1]), close = Number(p[2]), high = Number(p[3]), low = Number(p[4])
    const volume = Math.round(Number(p[5]) || 0)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (![open, close, high, low].every(v => Number.isFinite(v) && v > 0)) continue
    out.push({ date, open, high, low, close, volume })
  }
  if (!out.length) throw new Error('东财OHLC解析为空')
  return out
}

/** 腾讯日K OHLC 兜底 (fqkline qfqday: r[0]日期 r[1]开 r[2]收 r[3]高 r[4]低) */
async function fetchTxOhlcCn(code: string): Promise<KlineBar[]> {
  const tx = /^[56]/.test(code) ? `sh${code}` : `sz${code}`
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tx},day,,,660,qfq`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (func-server)' } })
  if (!res.ok) throw new Error(`腾讯OHLC HTTP ${res.status}`)
  const json = (await res.json()) as { data?: Record<string, { qfqday?: unknown[][]; day?: unknown[][] }> }
  const node = json?.data?.[tx]
  const rows = node?.qfqday || node?.day || []
  const out: KlineBar[] = []
  for (const r of rows as unknown[][]) {
    if (!Array.isArray(r) || r.length < 5) continue
    const date = String(r[0] || '')
    const open = Number(r[1]), close = Number(r[2]), high = Number(r[3]), low = Number(r[4])
    const volume = Math.round(Number(r[5]) || 0)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (![open, close, high, low].every(v => Number.isFinite(v) && v > 0)) continue
    out.push({ date, open, high, low, close, volume })
  }
  if (!out.length) throw new Error('腾讯OHLC解析为空')
  return out
}

async function fetchEmDailyCn(code: string): Promise<Array<{ date: string; close: number }>> {
  const market = /^[56]/.test(code) ? '1' : '0'
  const secid = `${market}.${code}`
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=500&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&ut=fa5fd1943c7b386f172d6893dbfba10b`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (func-server)' } })
  if (!res.ok) throw new Error(`东财日K HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { klines?: string[] } }
  const out: Array<{ date: string; close: number }> = []
  for (const k of json?.data?.klines || []) {
    const p = k.split(',')
    const date = (p[0] || '').trim()
    const close = Number(p[1])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
    out.push({ date, close })
  }
  if (!out.length) throw new Error('东财日K解析为空')
  return out
}

/** 腾讯 A股/ETF 日K兜底 (sh600519 / sz000001) */
async function fetchTxDailyCn(code: string): Promise<Array<{ date: string; close: number }>> {
  const tx = /^[56]/.test(code) ? `sh${code}` : `sz${code}`
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tx},day,,,660,qfq`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (func-server)' } })
  if (!res.ok) throw new Error(`腾讯日K HTTP ${res.status}`)
  const json = (await res.json()) as { data?: Record<string, { qfqday?: unknown[][]; day?: unknown[][] }> }
  const node = json?.data?.[tx]
  const rows = node?.qfqday || node?.day || []
  const out: Array<{ date: string; close: number }> = []
  for (const r of rows as unknown[][]) {
    if (!Array.isArray(r) || r.length < 3) continue
    const date = String(r[0] || '')
    const close = Number(r[2])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
    out.push({ date, close })
  }
  if (!out.length) throw new Error('腾讯日K解析为空')
  return out
}

/** 日K → 周K (ISO 周分组, 取每周最后交易日收盘) */
export function aggregateWeekly(daily: Array<{ date: string; close: number }>): Array<{ date: string; close: number }> {
  const out: Array<{ date: string; close: number }> = []
  let curWeek = ''
  let curBar: { date: string; close: number } | null = null
  for (const b of daily) {
    const d = new Date(`${b.date}T00:00:00Z`)
    const week = `${d.getUTCFullYear()}-W${String(isoWeek(d)).padStart(2, '0')}`
    if (week !== curWeek) {
      if (curBar) out.push(curBar)
      curWeek = week
      curBar = { ...b }
    } else {
      curBar = { date: b.date, close: b.close }
    }
  }
  if (curBar) out.push(curBar)
  return out
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}
