/**
 * 估值分位（市场温度计）核心逻辑 + 数据拉取
 *
 * 数据源（2026-08-14 对真实 API 实拉验证, 16/16 标的成功。均来自 datacenter-web, 带 CORS, 浏览器可直接 fetch）:
 *   - 宽基指数:  RPT_VALUEMARKET
 *       filter=(TRADE_MARKET_CODE="000300")  → 字段 PE_TTM_AVG (算术平均法, 无 PB 字段)
 *       每页上限 500 条, 翻页拿全 ~2334 条 (2017 年至今 ≈ 9.5 年)
 *   - 申万行业:  RPT_VALUEINDUSTRY_DET
 *       filter=(BOARD_CODE="016029")  → 字段 PE_TTM / PB_MRQ / TRADE_DATE
 *       pageSize=2400 一次拿全 ~2334 条
 *   最新一行 (TRADE_DATE 最大) 即当前值, 其余行构成历史序列用于算百分位。
 *
 * 已废弃的数据源（此前 16 行全 "—" 的真正根因）:
 *   - push2 stock/get 的 f162/f167: 对指数返回 0, 快照拿不到 PE/PB
 *   - RPT_VALUATIONANALYSIS: 报表配置不存在 (code 9501), 历史序列一直为空
 *   - danjuan index_eva: PE/PB/分位全有, 但无 CORS 头, 浏览器读不到
 *
 * 失败兜底: 抛带类型前缀的 Error, 由 fetchOne 捕获后写入 failReason 而非 throw.
 */

import type {
  ValuationSymbol,
  ValuationRow,
  BucketSide,
  BucketTone
} from '@/types/valuation'

// ---------- 内置标的列表 (6 宽基 + 10 申万行业, 全部对齐已验证数据源) ----------

export const BUILTIN_SYMBOLS: ValuationSymbol[] = [
  // —— 6 宽基指数: RPT_VALUEMARKET 仅覆盖以下市场 ——
  // 原需求的中证500(000905)/中证1000(000852)/上证50(000016) 不在该报表,
  // 且无其他浏览器可用的 CORS 数据源, 故以同样具有代表性的宽基替代。
  { code: '000001', symbol: 'sh000001', name: '上证指数', kind: 'index' },
  { code: '000300', symbol: 'sh000300', name: '沪深300',  kind: 'index' },
  { code: '399001', symbol: 'sz399001', name: '深证成指', kind: 'index' },
  { code: '399006', symbol: 'sz399006', name: '创业板指', kind: 'index' },
  { code: '000688', symbol: 'sh000688', name: '科创50',   kind: 'index' },
  { code: '899050', symbol: 'bj899050', name: '北证50',   kind: 'index' },
  // —— 10 申万行业: RPT_VALUEINDUSTRY_DET 为申万三级粒度, 每个目标一级行业取代表性三级子行业 ——
  { code: '016029', symbol: '016029', name: '银行Ⅱ',   kind: 'industry' },  // 申万一级: 银行
  { code: '016024', symbol: '016024', name: '化学制药', kind: 'industry' },  // 申万一级: 医药生物
  { code: '016077', symbol: '016077', name: '半导体',   kind: 'industry' },  // 申万一级: 电子
  { code: '016057', symbol: '016057', name: '软件开发', kind: 'industry' },  // 申万一级: 计算机
  { code: '016165', symbol: '016165', name: '白酒Ⅱ',   kind: 'industry' },  // 申万一级: 食品饮料
  { code: '016074', symbol: '016074', name: '电池',     kind: 'industry' },  // 申万一级: 电力设备
  { code: '016027', symbol: '016027', name: '证券Ⅱ',   kind: 'industry' },  // 申万一级: 非银金融
  { code: '016087', symbol: '016087', name: '游戏Ⅱ',   kind: 'industry' },  // 申万一级: 传媒
  { code: '016015', symbol: '016015', name: '通信设备', kind: 'industry' },  // 申万一级: 通信
  { code: '016113', symbol: '016113', name: '服装家纺', kind: 'industry' }   // 申万一级: 纺织服饰
]

// ---------- 5 档分级定义 ----------

export interface BucketDef {
  side: BucketSide
  label: string
  advice: string
  tone: BucketTone
  /** 包含下界 (含), 单位: 百分位 0-100 */
  minInclusive: number
  /** 包含上界 (含), null 表示 +∞ */
  maxInclusive: number | null
}

export const FIVE_BUCKETS: BucketDef[] = [
  { side: 'low',  label: '极度低估', advice: '黄金坑',     tone: 'green', minInclusive: 0,  maxInclusive: 20 },
  { side: 'low',  label: '低估区域', advice: '分批建仓',   tone: 'green', minInclusive: 20, maxInclusive: 40 },
  { side: 'flat', label: '合理估值', advice: '持有观望',   tone: 'blue',  minInclusive: 40, maxInclusive: 60 },
  { side: 'high', label: '偏高估值', advice: '逐步减仓',   tone: 'red',   minInclusive: 60, maxInclusive: 80 },
  { side: 'high', label: '极度高估', advice: '坚决远离',   tone: 'red',   minInclusive: 80, maxInclusive: null }
]

// ---------- 纯函数: 计算百分位 ----------

/**
 * 计算当前值在历史序列中的百分位
 * - 过滤掉 null/0/负数/非数
 * - 空过滤后序列 → null
 * - 序列仅 1 个元素 → 50 (兜底, 避免 UI 出现空分位)
 * - 全相同值 → 50
 * - 公式: count(<= current) / total × 100, 向上取整
 */
export function computePercentile(series: Array<number | null | undefined>, current: number | null | undefined): number | null {
  if (current == null || !Number.isFinite(current)) return null
  const cleaned: number[] = []
  for (const v of series) {
    if (v == null) continue
    if (typeof v !== 'number') continue
    if (!Number.isFinite(v)) continue
    if (v <= 0) continue
    cleaned.push(v)
  }
  if (cleaned.length === 0) return null
  if (cleaned.length === 1) return 50
  const allSame = cleaned.every(v => v === cleaned[0])
  if (allSame) return 50
  let le = 0
  for (const v of cleaned) if (v <= current) le++
  return Math.ceil((le / cleaned.length) * 100)
}

// ---------- 纯函数: 5 档分级 ----------

export interface BucketInfo {
  side: BucketSide | null
  label: string | null
  advice: string | null
  tone: BucketTone | null
}

export function bucketByPercentile(p: number | null | undefined): BucketInfo {
  if (p == null || !Number.isFinite(p)) {
    return { side: null, label: null, advice: null, tone: null }
  }
  for (const b of FIVE_BUCKETS) {
    const inMin = p >= b.minInclusive
    const inMax = b.maxInclusive == null ? true : p < b.maxInclusive
    if (inMin && inMax) {
      return { side: b.side, label: b.label, advice: b.advice, tone: b.tone }
    }
  }
  // 兜底 (p=100 等极端值)
  return { side: 'high', label: '极度高估', advice: '坚决远离', tone: 'red' }
}

// ---------- 纯函数: 解析数据中心估值历史 ----------

export interface ValuationHistoryPoint {
  date: string       // 'YYYY-MM-DD'
  peTtm: number      // 元 (东财已直接返回元单位)
  pb: number | null
}

/** 解析东财 TRADE_DATE (可能是 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm:ss'), 归一为 'YYYY-MM-DD' */
function parseTradeDate(value: unknown): string | null {
  const s = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  return s.slice(0, 10)
}

/**
 * 解析 datacenter-web.eastmoney.com 估值历史响应
 * 路径: result.data[] 每条 { TRADE_DATE, [peField], [pbField], ... }
 *   - 指数 RPT_VALUEMARKET:        peField='PE_TTM_AVG', pbField=null (无 PB)
 *   - 行业 RPT_VALUEINDUSTRY_DET:  peField='PE_TTM',      pbField='PB_MRQ'
 * - PE ≤ 0 或非数 → 跳过该行 (无意义数据)
 * - PB ≤ 0 或缺失 → pb = null (不阻塞该行)
 */
export function parseEastmoneyValuationHistory(
  payload: unknown,
  peField = 'PE_TTM',
  pbField: string | null = 'PB'
): ValuationHistoryPoint[] {
  if (!payload || typeof payload !== 'object') return []
  const result = (payload as { result?: { data?: unknown[] } }).result
  if (!result || !Array.isArray(result.data)) return []
  const out: ValuationHistoryPoint[] = []
  for (const row of result.data) {
    if (!row || typeof row !== 'object') continue
    const obj = row as { TRADE_DATE?: unknown; [key: string]: unknown }
    const date = parseTradeDate(obj.TRADE_DATE)
    if (!date) continue
    const peRaw = Number(obj[peField])
    if (!Number.isFinite(peRaw) || peRaw <= 0) continue
    let pb: number | null = null
    if (pbField) {
      const pbRaw = Number(obj[pbField])
      if (Number.isFinite(pbRaw) && pbRaw > 0) pb = pbRaw
    }
    out.push({ date, peTtm: peRaw, pb })
  }
  return out
}

// ---------- 纯函数: 文本去除/过滤 (搜索用) ----------

export function matchesSearch(row: { name: string; code: string }, q: string): boolean {
  if (!q) return true
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return row.name.toLowerCase().includes(needle) || row.code.toLowerCase().includes(needle)
}

// ---------- 数据中心拉取 ----------

const HISTORY_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get'

/** fetch 带超时 (浏览器默认 fetch 无超时, 公共接口可能挂起) */
async function fetchWithTimeout(url: string, ms: number, referer?: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, {
      cache: 'no-cache',
      signal: ctrl.signal,
      headers: referer ? { Referer: referer } : undefined
    } as RequestInit)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 请求东财数据中心报表一页。filter 用真实字符, 交给 URLSearchParams 一次性编码
 * (手写 %3D / %22 会被 .toString() 二次编码成 %253D / %2522, 服务器解析失败 → 空 data)。
 */
async function requestData(
  reportName: string,
  filterExpr: string,
  columns: string,
  pageNumber: number,
  pageSize: number
): Promise<unknown> {
  const params = new URLSearchParams({
    reportName,
    columns,
    pageNumber: String(pageNumber),
    pageSize: String(pageSize),
    filter: filterExpr,
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
    source: 'WEB',
    client: 'WEB'
  })
  const url = `${HISTORY_URL}?${params.toString()}`
  let res: Response
  try {
    res = await fetchWithTimeout(url, 8000, 'https://data.eastmoney.com/')
  } catch (e) {
    throw new Error('network-fail: ' + (e instanceof Error ? e.message : 'unknown'))
  }
  if (!res.ok) throw new Error('history-fail: HTTP ' + res.status)
  let j: unknown
  try {
    j = await res.json()
  } catch {
    throw new Error('history-fail: json-parse')
  }
  return j
}

/** 单个标的的估值结果: 当前 PE/PB + 历史 PE 序列 (用于百分位) */
interface ValuationSeries {
  peTtm: number | null
  pb: number | null
  history: number[]
}

/**
 * 宽基指数: RPT_VALUEMARKET
 * 每页上限 500 条, 循环翻页直到拿满 result.count (约 5 页 / 2334 条 / 9.5 年)。
 * 降序返回, 第 1 条即最新交易日 (当前值)。
 */
async function fetchMarketValuation(symbol: ValuationSymbol): Promise<ValuationSeries> {
  const code = symbol.code
  const perPage = 500
  const all: ValuationHistoryPoint[] = []
  let total = 0
  let page = 1
  for (;;) {
    const payload = await requestData(
      'RPT_VALUEMARKET',
      `(TRADE_MARKET_CODE="${code}")`,
      'TRADE_DATE,PE_TTM_AVG',
      page,
      perPage
    )
    const result = (payload as { result?: { count?: unknown } }).result
    if (result && typeof result.count === 'number') total = result.count
    const parsed = parseEastmoneyValuationHistory(payload, 'PE_TTM_AVG', null)
    if (parsed.length === 0) break
    all.push(...parsed)
    if (all.length >= total || parsed.length < perPage) break
    page++
  }
  if (all.length === 0) throw new Error('history-empty')
  const current = all[0]
  return {
    peTtm: current.peTtm,
    pb: null,  // RPT_VALUEMARKET 无 PB 字段
    history: all.map(p => p.peTtm).filter((v): v is number => v != null)
  }
}

/**
 * 申万行业: RPT_VALUEINDUSTRY_DET
 * pageSize=2400 一次拿全 ~2334 条 (2017 年至今)。降序返回, 第 1 条即当前值。
 */
async function fetchIndustryValuation(symbol: ValuationSymbol): Promise<ValuationSeries> {
  const code = symbol.code
  const payload = await requestData(
    'RPT_VALUEINDUSTRY_DET',
    `(BOARD_CODE="${code}")`,
    'TRADE_DATE,PE_TTM,PB_MRQ',
    1,
    2400
  )
  const rows = parseEastmoneyValuationHistory(payload, 'PE_TTM', 'PB_MRQ')
  if (rows.length === 0) throw new Error('history-empty')
  const current = rows[0]
  return {
    peTtm: current.peTtm,
    pb: current.pb,
    history: rows.map(p => p.peTtm).filter((v): v is number => v != null)
  }
}

/**
 * 拉取单标的完整估值行. 失败不抛, 写 failReason (枚举字符串).
 * 指数走 RPT_VALUEMARKET, 行业走 RPT_VALUEINDUSTRY_DET.
 */
export async function fetchOne(symbol: ValuationSymbol): Promise<ValuationRow> {
  const base: ValuationRow = {
    code: symbol.symbol,
    name: symbol.name,
    kind: symbol.kind,
    peTtm: null,
    pb: null,
    percentile: null,
    bucket: null,
    bucketLabel: null,
    bucketAdvice: null,
    bucketTone: null,
    fetchedAt: Date.now()
  }
  try {
    const data = symbol.kind === 'index'
      ? await fetchMarketValuation(symbol)
      : await fetchIndustryValuation(symbol)
    const pct = computePercentile(data.history, data.peTtm)
    const bk = bucketByPercentile(pct)
    return {
      ...base,
      peTtm: data.peTtm,
      pb: data.pb,
      percentile: pct,
      bucket: bk.side,
      bucketLabel: bk.label,
      bucketAdvice: bk.advice,
      bucketTone: bk.tone
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown-fail'
    return { ...base, failReason: msg }
  }
}
