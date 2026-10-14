/**
 * 回测数据层: 预置目标解析 + 东财日K/基金净值拉取 + IndexData/FundNavHistory 缓存回填 + 美元汇率
 * 数据源:
 * - 指数/ETF 日K: push2his.eastmoney.com klt=101 fqt=1
 * - 场外基金净值: api.fund.eastmoney.com f10/lsjz (累计净值, 需 Referer)
 * - 美元兑离岸人民币: secid=133.USDCNH (东财外汇日线)
 */
import { execFile } from 'node:child_process'
import { prisma } from './prisma'

export interface Bar { date: string; close: number }
export interface ResolvedTarget { key: string; name: string; secid: string; currency: 'CNY' | 'USD'; type: 'index' | 'fund' }

/** 解析用户输入: 6位纯数字→场外基金(CNY); 100/105/106 前缀→美股指数(USD); 其他含点→指数(CNY) */
export function resolveTarget(input: string): ResolvedTarget {
  const s = input.trim()
  if (/^\d{6}$/.test(s)) {
    return { key: s, name: `基金${s}`, secid: s, currency: 'CNY', type: 'fund' }
  }
  if (s.includes('.')) {
    const market = s.split('.')[0]
    const usd = market === '100' || market === '105' || market === '106'
    return { key: s, name: s, secid: s, currency: usd ? 'USD' : 'CNY', type: 'index' }
  }
  throw new Error(`无法识别的目标: ${input}`)
}

export const PRESET_TARGETS: ResolvedTarget[] = [
  { key: 'shangzheng', name: '上证指数', secid: '1.000001', currency: 'CNY', type: 'index' },
  { key: 'hs300', name: '沪深300', secid: '1.000300', currency: 'CNY', type: 'index' },
  { key: 'csi500', name: '中证500', secid: '1.000905', currency: 'CNY', type: 'index' },
  { key: 'chinext', name: '创业板指', secid: '0.399006', currency: 'CNY', type: 'index' },
  { key: 'ndx', name: '纳斯达克100', secid: '100.NDX', currency: 'USD', type: 'index' },
  { key: 'spx', name: '标普500', secid: '100.SPX', currency: 'USD', type: 'index' },
  { key: 'ndxEtf', name: '纳指ETF', secid: '513100', currency: 'CNY', type: 'fund' },
  { key: 'spxEtf', name: '标普500ETF', secid: '513500', currency: 'CNY', type: 'fund' }
]

/** curl 兜底: 东财行情域名会按客户端指纹拦截 Node fetch/https (服务器实测 100% 断连), 用系统 curl 规避 */
async function fetchJsonViaCurl(url: string, headers: Record<string, string>): Promise<unknown> {
  const args = ['-s', '--compressed', '--max-time', '12', '--retry', '2', '--retry-all-errors', '--retry-delay', '1']
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
  args.push(url)
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, timeout: 45000 }, (err, out) => {
      if (err) reject(err)
      else resolve(out)
    })
  })
  const trimmed = stdout.trim()
  if (!trimmed || trimmed === 'null') throw new Error(`curl 空响应: ${url}`)
  return JSON.parse(trimmed)
}

/** GET JSON; push2his 域名必须 curl-only: node fetch 的 TLS 指纹会触发对端 WAF 拉黑服务器 IP (实测连 curl 一起 000), 其他域名 fetch 优先 + curl 兜底 */
async function fetchJsonRetry(url: string, headers: Record<string, string>, prefer: 'fetch' | 'curl' = 'fetch'): Promise<unknown> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    if (prefer === 'fetch') {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      try {
        const res = await fetch(url, { headers, signal: ctrl.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
      } catch (e) {
        lastErr = e
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      return await fetchJsonViaCurl(url, headers)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** 东财日K: klines 每项 "2026-09-30,3872.14"; 空数据抛错 */
export async function fetchEastmoneyKline(secid: string, lmt: number): Promise<Bar[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=${lmt}&end=20500101&fields1=f1,f2,f3&fields2=f51,f53`
  const json = await fetchJsonRetry(url, { 'User-Agent': 'Mozilla/5.0 (func-server)', Referer: 'https://quote.eastmoney.com/' }, 'curl')
  const klines = (json as { data?: { klines?: unknown } } | null)?.data?.klines
  const bars: Bar[] = []
  if (Array.isArray(klines)) {
    for (const k of klines) {
      if (typeof k !== 'string') continue
      const parts = k.split(',')
      const date = (parts[0] || '').trim()
      const close = Number(parts[1])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
      bars.push({ date, close: Math.round(close * 100) / 100 })
    }
  }
  if (bars.length === 0) throw new Error(`东财日K无数据: ${secid}`)
  return bars
}

/** 场外基金历史净值 (东财 f10/lsjz 翻页, 取累计净值 LJJZ, 空/0 跳过), 按日期升序 */
export async function fetchFundNav(code: string): Promise<Bar[]> {
  const headers = { 'User-Agent': 'Mozilla/5.0 (func-server)', Referer: `https://fundf10.eastmoney.com/jjjz_${code}.html` }
  const all: Bar[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= 220 && all.length < 4200; page++) {
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${page}&pageSize=200`
    const json = await fetchJsonRetry(url, headers)
    const list = (json as { Data?: { LSJZList?: unknown } } | null)?.Data?.LSJZList
    if (!Array.isArray(list) || list.length === 0) break
    let fresh = 0
    for (const r of list) {
      if (!r || typeof r !== 'object') continue
      const o = r as { FSRQ?: unknown; LJJZ?: unknown }
      const date = String(o.FSRQ || '')
      const close = Number(o.LJJZ)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
      if (seen.has(date)) continue
      seen.add(date)
      all.push({ date, close: Math.round(close * 10000) / 10000 })
      fresh++
    }
    // 整页都是重复数据 → 已到最早记录
    if (fresh === 0) break
  }
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return all
}

/** IndexData data 字段 → Bar (兼容 {date,close} 对象 / 纯数字 / 数字字符串) */
function indexRowToBar(row: { date: string; data: unknown }): Bar | null {
  const d = row.data
  const raw = d !== null && typeof d === 'object' ? (d as { close?: unknown }).close : d
  const close = Number(raw)
  if (!Number.isFinite(close) || close <= 0) return null
  return { date: row.date, close }
}

/** 回填 IndexData (id=symbol::date, data={date,close}), 分批 500 upsert */
async function upsertIndexBars(symbol: string, bars: Bar[]): Promise<void> {
  for (let i = 0; i < bars.length; i += 500) {
    const chunk = bars.slice(i, i + 500)
    await prisma.$transaction(chunk.map(b => prisma.indexData.upsert({
      where: { id: `${symbol}::${b.date}` },
      create: { id: `${symbol}::${b.date}`, symbol, date: b.date, data: { date: b.date, close: b.close, source: 'eastmoney-kline' } },
      update: { data: { date: b.date, close: b.close, source: 'eastmoney-kline' } }
    })))
  }
}

/** 回填 FundNavHistory (nav/accNav 存累计净值), 分批 500 upsert */
async function upsertFundBars(code: string, bars: Bar[]): Promise<void> {
  for (let i = 0; i < bars.length; i += 500) {
    const chunk = bars.slice(i, i + 500)
    await prisma.$transaction(chunk.map(b => prisma.fundNavHistory.upsert({
      where: { code_date: { code, date: b.date } },
      create: { code, date: b.date, nav: b.close, accNav: b.close, source: 'eastmoney-lsjz' },
      update: { nav: b.close, accNav: b.close }
    })))
  }
}

/** 主入口: 先读库, 达标返回 db; 不足则拉取回填后返回 fetch, 仍不足抛错 */
export async function getDailyBars(target: ResolvedTarget, minBars: number): Promise<{ bars: Bar[]; source: 'db' | 'fetch' }> {
  let bars: Bar[]
  if (target.type === 'fund') {
    const rows = await prisma.fundNavHistory.findMany({ where: { code: target.secid }, orderBy: { date: 'asc' }, select: { date: true, nav: true } })
    bars = rows.map(r => ({ date: r.date, close: r.nav })).filter(b => Number.isFinite(b.close) && b.close > 0)
  } else {
    const rows = await prisma.indexData.findMany({ where: { symbol: target.secid }, orderBy: { date: 'asc' }, select: { date: true, data: true } })
    bars = rows.map(indexRowToBar).filter((b): b is Bar => b !== null)
  }
  if (bars.length >= minBars) return { bars, source: 'db' }

  const fetched = target.type === 'fund'
    ? await fetchFundNav(target.secid)
    : await fetchEastmoneyKline(target.secid, Math.max(minBars, 4200))
  if (target.type === 'fund') await upsertFundBars(target.secid, fetched)
  else await upsertIndexBars(target.secid, fetched)
  bars = fetched
  if (bars.length < minBars) throw new Error(`数据不足: ${target.name} 仅 ${bars.length} 条`)
  return { bars, source: 'fetch' }
}

/** 美元兑离岸人民币日线: 库内不足 3000 条则拉取回填 */
export async function getFxUsdcnh(): Promise<Bar[]> {
  const rows = await prisma.indexData.findMany({ where: { symbol: '133.USDCNH' }, orderBy: { date: 'asc' }, select: { date: true, data: true } })
  const bars = rows.map(indexRowToBar).filter((b): b is Bar => b !== null)
  if (bars.length >= 3000) return bars
  const fetched = await fetchEastmoneyKline('133.USDCNH', 4200)
  await upsertIndexBars('133.USDCNH', fetched)
  return fetched
}

/** 日期升序前向填充: 每目标日期 → ≤ 该日的最近汇率; 早于首条汇率的日期用首条 */
export function fillForwardFx(fxBars: Bar[], dates: string[]): Map<string, number> {
  const out = new Map<string, number>()
  if (fxBars.length === 0) return out
  let i = 0
  for (const d of dates) {
    while (i + 1 < fxBars.length && fxBars[i + 1].date <= d) i++
    out.set(d, fxBars[i].close)
  }
  return out
}
