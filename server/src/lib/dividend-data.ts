/**
 * 红利分数数据层: 原子数据获取 (成分名单/批量快照/分红明细/个股波动率/指数日K/国债收益/ROE) + IndexData 快照读写
 * 数据源 (2026-10 实测, 东财 push2/push2his 已封腾讯云 IP 段故全部绕开):
 * - 中证红利成分名单: 新浪 vII_NewestComponent (官方名单镜像, 100 只, GBK HTML)
 * - 个股快照 (价/市值): 腾讯 qt.gtimg.cn 批量 (一次 ≤60 只)
 * - 个股日K (波动率): 腾讯 fqkline 前复权 160 根
 * - 中证红利指数日K: 腾讯 fqkline 分段 (3 年一段, 2011~今, 单段>3200 会 param error)
 * - 个股分红明细: 东财 datacenter RPT_SHAREBONUS_DET (每股派息=PRETAX_BONUS_RMB/10, BASIC_EPS 算派息率)
 * - ROE: 东财 datacenter F10 主要指标 RPT_F10_FINANCE_MAINFINADATA (WEIGHTAVG_ROE 字段)
 * - 10Y 国债收益率: 东财 datacenter RPTA_WEB_TREASURYYIELD EMM00166466
 * 服务器实测: DNS IPv6 优先但 IPv6 出口不通 → curl 必须加 -4 (--ipv4)
 * 注意: 本模块只提供原子函数, 候选组装编排在上层 dividend-run.ts (便于测试 mock 跨模块调用点)
 */
import { execFile } from 'node:child_process'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import type { Bar, YieldPoint } from './dividend-engine'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** curl 兜底: 行情域名按客户端指纹拦截 Node fetch, 且服务器 DNS IPv6 优先但 IPv6 出口不通, 强制 -4 */
async function curlRaw(url: string, timeoutSec = 15): Promise<string> {
  const args = ['-4', '-s', '--compressed', '--max-time', String(timeoutSec), '--retry', '2', '--retry-all-errors', '--retry-delay', '1', '-A', UA, url]
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, timeout: (timeoutSec + 35) * 1000 }, (err, out) => {
      if (err) reject(err)
      else resolve(out)
    })
  })
  const trimmed = stdout.trim()
  if (!trimmed || trimmed === 'null') throw new Error(`curl 空响应: ${url.slice(0, 80)}`)
  return trimmed
}

async function fetchJsonViaCurl(url: string, timeoutSec = 15): Promise<unknown> {
  const raw = await curlRaw(url, timeoutSec)
  return JSON.parse(raw)
}

/** datacenter 域名: fetch 优先 + curl 兜底 */
async function fetchJsonRetry(url: string): Promise<unknown> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 0) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      try {
        const res = await fetch(url, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
      } catch (e) {
        lastErr = e
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      return await fetchJsonViaCurl(url)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** 数值字段解析: 东财对缺失值返回 '-' 字符串 */
function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** 东财/腾讯市场代号: 5/6/9 开头沪市(sh), 其余深市(sz) */
function tqSymbol(code: string): string {
  return code.startsWith('6') || code.startsWith('9') || code.startsWith('5') ? `sh${code}` : `sz${code}`
}

/** 中证红利成分名单: 新浪 vII_NewestComponent (GBK HTML, 提取 6 位代码) */
export async function fetchConstituentCodes(): Promise<string[]> {
  const url = 'http://vip.stock.finance.sina.com.cn/corp/go.php/vII_NewestComponent/indexid/000922.phtml'
  const raw = await curlRaw(url, 20)
  // GBK → UTF-8: 只需要提取代码, 直接从原始字节找 ASCII 代码即可 (iconv 不可用时也稳定)
  const codes = [...raw.matchAll(/>(\d{6})</g)].map(m => m[1]!)
  const unique = [...new Set(codes)]
  if (unique.length < 50) throw new Error(`成分名单解析异常: 仅 ${unique.length} 只`)
  return unique
}

/** 腾讯批量快照单行 */
export interface TqQuote {
  code: string
  name: string
  price: number
  /** 总市值 (亿) */
  marketCap: number
  /** 成交额 (万元) */
  amount: number
}

/** 腾讯 qt 批量快照: v_shXXXX="1~名称~代码~现价~..." 解析第 4 字段现价、第 46 字段总市值(亿)、第 38 字段成交额(万元) */
export async function fetchTencentQuotes(codes: string[]): Promise<Map<string, TqQuote>> {
  const out = new Map<string, TqQuote>()
  for (let i = 0; i < codes.length; i += 50) {
    const batch = codes.slice(i, i + 50)
    const url = `https://qt.gtimg.cn/q=${batch.map(tqSymbol).join(',')}`
    const raw = await curlRaw(url, 15)
    for (const m of raw.matchAll(/v_(?:sh|sz)(\d{6})="([^"]*)"/g)) {
      const code = m[1]!
      const f = m[2]!.split('~')
      const price = Number(f[3])
      const marketCap = Number(f[45]) // 总市值(亿)
      const amount = Number(f[37]) // 成交额(万元)
      if (!Number.isFinite(price) || price <= 0) continue // 停牌股价格为空串
      out.set(code, {
        code,
        name: (f[1] ?? code).replace(/\s+/g, ''),
        price,
        marketCap: Number.isFinite(marketCap) ? marketCap : 0,
        amount: Number.isFinite(amount) ? amount : 0
      })
    }
    await sleep(300)
  }
  return out
}

/** 个股分红明细统计结果 */
export interface DividendInfo {
  /** 近 12 个月每股税前派息合计 (元) */
  ttmDivPerShare: number
  /** 连续现金分红年数 (按除息日年份, 从最新往前数到断档为止) */
  consecutiveYears: number
  /** 派息率 = ttm 每股派息 / 窗口覆盖年度 BASIC_EPS 合计 */
  payoutRatio: number | null
}

/**
 * 个股分红明细: 统计 TTM 每股派息、连续分红年数与派息率。
 * 只统计 ASSIGN_PROGRESS='实施分配' 的记录; 每股派息 = PRETAX_BONUS_RMB/10 (每10股派息税前)。
 */
export async function fetchDividendInfo(code: string): Promise<DividendInfo | null> {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=200&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1`
  const json = await fetchJsonRetry(url) as {
    result?: { data?: Array<Record<string, unknown>> } | null
  } | null
  const rows = json?.result?.data
  if (!Array.isArray(rows) || rows.length === 0) return null

  const implemented = rows
    .map(r => ({
      date: String(r.EX_DIVIDEND_DATE ?? '').slice(0, 10),
      perShare: num(r.PRETAX_BONUS_RMB) !== null ? (num(r.PRETAX_BONUS_RMB) as number) / 10 : null,
      eps: num(r.BASIC_EPS)
    }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.perShare !== null && r.perShare >= 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  if (implemented.length === 0) return null

  // TTM: (最新除息日 - 365天, 最新除息日] 窗口内的每股派息合计 (半年分红两派可完整覆盖)
  const latestDate = implemented[implemented.length - 1]!.date
  const cutoff = new Date(new Date(`${latestDate}T00:00:00Z`).getTime() - 365 * 86400000).toISOString().slice(0, 10)
  let ttm = 0
  const epsWindow = new Map<string, number>() // 窗口内各年度的 BASIC_EPS (取首次出现)
  const yearSet = new Set<string>()
  for (const r of implemented) {
    yearSet.add(r.date.slice(0, 4))
    if (r.date > cutoff) {
      ttm += r.perShare as number
      if (r.eps !== null && !epsWindow.has(r.date.slice(0, 4))) epsWindow.set(r.date.slice(0, 4), r.eps)
    }
  }
  if (ttm <= 0) return null

  // 连续分红年数: 从最新除息年往前数有分红的年份, 断档即止 (当年未到分红期不算断档)
  let years = 1
  let y = Number(latestDate.slice(0, 4))
  while (years < 30 && yearSet.has(String(y - 1))) {
    years++
    y--
  }

  // 派息率: TTM 每股派息 / 窗口覆盖年度的 BASIC_EPS 合计; EPS 缺失或 ≤0 → null
  const epsSum = [...epsWindow.values()].reduce((s, v) => s + v, 0)
  const payoutRatio = epsSum > 0 ? ttm / epsSum : null
  return { ttmDivPerShare: ttm, consecutiveYears: years, payoutRatio }
}

/** 最新报告期加权 ROE (百分数值), 失败返回 null (引擎给中性分) */
export async function fetchRoe(code: string): Promise<number | null> {
  try {
    const secucode = code.startsWith('6') || code.startsWith('9') || code.startsWith('5') ? `${code}.SH` : `${code}.SZ`
    // columns=ALL: 指定 columns=WEIGHTAVG_ROE 会被 9501 "字段不存在" 拒绝 (字段已改名), 实际字段为 ROEJQ (加权)
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECUCODE%3D%22${secucode}%22)&pageSize=1&sortColumns=REPORT_DATE&sortTypes=-1&source=HSF10&client=PC`
    const json = await fetchJsonRetry(url) as {
      result?: { data?: Array<Record<string, unknown>> } | null
    } | null
    const row = json?.result?.data?.[0]
    if (!row) return null
    return num(row.ROEJQ) ?? num(row.WEIGHTAVG_ROE)
  } catch {
    return null
  }
}

/** 近 120 日日收益率标准差年化 (百分数值); 新浪日K 160 根 (ifzq 被 501 拦, 新浪个股日K实测更新到最新); 需 ≥60 个有效收益率, 失败返回 null (引擎给中性分) */
export async function fetchStockVol(code: string): Promise<number | null> {
  try {
    const sym = tqSymbol(code)
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=160`
    const raw = await curlRaw(url, 20)
    const rows = JSON.parse(raw) as Array<{ day?: unknown; close?: unknown }>
    if (!Array.isArray(rows) || rows.length < 61) return null
    const closes: number[] = []
    for (const k of rows) {
      const c = Number(k?.close)
      if (Number.isFinite(c) && c > 0) closes.push(c)
    }
    if (closes.length < 61) return null
    const rets: number[] = []
    for (let i = closes.length - 120; i < closes.length; i++) {
      if (i <= 0) continue
      rets.push(closes[i] / closes[i - 1] - 1)
    }
    if (rets.length < 60) return null
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length
    const variance = rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (rets.length - 1)
    return Math.sqrt(variance) * Math.sqrt(244) * 100 // 年化, 百分数
  } catch {
    return null // 单股波动率失败不阻塞整体, 引擎给中性分
  }
}

/**
 * 中证红利指数日K: 腾讯代理域名 proxy.finance.qq.com/ifzqgtimg (web.ifzq.gtimg.cn 被 501 挑战页拦截,
 * 同一数据经代理域名实测 2011~今 5 段全部可用, 新浪指数日线停更于 2019 弃用)。
 * 3 年一段拼接, 单段 1200 根足够 (3 年约 730 根)。
 */
export async function fetchIndexBars(): Promise<Bar[]> {
  const byDate = new Map<string, number>()
  const currentYear = new Date().getFullYear()
  for (let y0 = 2011; y0 <= currentYear; y0 += 3) {
    const y1 = Math.min(y0 + 2, currentYear)
    const url = `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get?param=sh000922,day,${y0}-01-01,${y1}-12-31,1200,qfq`
    let json: { data?: Record<string, unknown> } | null = null
    for (let attempt = 0; attempt < 3 && !json; attempt++) {
      try {
        json = await fetchJsonViaCurl(url) as { data?: Record<string, unknown> } | null
      } catch (e) {
        if (attempt === 2) throw new Error(`指数日K分段 ${y0} 拉取失败: ${(e as Error).message.slice(0, 80)}`)
        await sleep(1500 * (attempt + 1))
      }
    }
    const node = json?.data?.sh000922 as { qfqday?: unknown; day?: unknown } | undefined
    const klines = (node?.qfqday ?? node?.day) as unknown
    if (!Array.isArray(klines)) continue
    for (const k of klines) {
      if (!Array.isArray(k)) continue
      const date = String(k[0] ?? '')
      const close = Number(k[2])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
      byDate.set(date, close)
    }
    await sleep(400)
  }
  if (byDate.size < 2000) throw new Error(`中证红利指数日K不足: 仅 ${byDate.size} 根`)
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, close]) => ({ date, close }))
}

/** 10Y 国债收益率 (EMM00166466), 翻页拉到覆盖 1250 交易日+ (约 3~4 页×500) */
export async function fetchTreasuryYields(): Promise<YieldPoint[]> {
  const out: YieldPoint[] = []
  for (let page = 1; page <= 6; page++) {
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_TREASURYYIELD&columns=ALL&pageSize=500&pageNumber=${page}&sortColumns=SOLAR_DATE&sortTypes=-1`
    const json = await fetchJsonRetry(url) as {
      result?: {
        pages?: number
        data?: Array<{ SOLAR_DATE?: unknown; EMM00166466?: unknown }>
      } | null
    } | null
    const rows = json?.result?.data
    if (!Array.isArray(rows) || rows.length === 0) break
    for (const r of rows) {
      const date = String(r.SOLAR_DATE ?? '').slice(0, 10)
      const v = num(r.EMM00166466)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && v !== null) out.push({ date, value: v })
    }
    if ((json?.result?.pages ?? 0) <= page || out.length >= 1300) break
    await sleep(200)
  }
  if (out.length < 1000) throw new Error(`10Y 国债收益率数据不足: 仅 ${out.length} 条`)
  return out
}

/** IndexData 单行快照读写 */
export const SNAPSHOT_ID = 'dividend-score::latest'
export const SNAPSHOT_SYMBOL = 'dividend-score'

export async function saveSnapshot(data: unknown, date: string): Promise<void> {
  const payload = data as Prisma.InputJsonValue
  await prisma.indexData.upsert({
    where: { id: SNAPSHOT_ID },
    create: { id: SNAPSHOT_ID, symbol: SNAPSHOT_SYMBOL, date, data: payload },
    update: { date, data: payload }
  })
}

export async function loadSnapshot(): Promise<unknown | null> {
  const row = await prisma.indexData.findUnique({ where: { id: SNAPSHOT_ID }, select: { data: true } })
  return row?.data ?? null
}
