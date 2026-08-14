/**
 * 估值分位（市场温度计）核心逻辑 + 数据拉取
 *
 * 数据源（沿用 fundQuote.ts 同样的 JSONP 策略绕 CORS）:
 *   - 单标的快照:  push2.eastmoney.com/api/qt/stock/get
 *       字段: f43(最新价×1000), f57(代码), f58(名称), f9(PE-TTM×100), f23(PB×100)
 *   - K 线 (含 PE-TTM 历史):  push2his.eastmoney.com/api/qt/stock/kline/get
 *       字段 klines: "yyyy-MM-dd,open,close,high,low,vol,amount,pe_ttm"
 *
 * 失败兜底: 抛带类型前缀的 Error, 由 fetchOne 捕获后写入 failReason 而非 throw.
 * 解析函数 (parseEastmoneyKline / parseEastmoneySnapshot) 为纯函数, 便于单测.
 */

import type {
  ValuationSymbol,
  ValuationRow,
  BucketSide,
  BucketTone
} from '@/types/valuation'

// ---------- 内置标的列表 (硬编码, 6 宽基 + 10 申万一级行业) ----------

export const BUILTIN_SYMBOLS: ValuationSymbol[] = [
  // 6 宽基指数
  { code: '1.000300', symbol: 'sh000300', name: '沪深300',     kind: 'index' },
  { code: '1.000905', symbol: 'sh000905', name: '中证500',     kind: 'index' },
  { code: '1.000852', symbol: 'sh000852', name: '中证1000',    kind: 'index' },
  { code: '0.399006', symbol: 'sz399006', name: '创业板指',    kind: 'index' },
  { code: '1.000688', symbol: 'sh000688', name: '科创50',      kind: 'index' },
  { code: '1.000016', symbol: 'sh000016', name: '上证50',      kind: 'index' },
  // 10 申万一级行业 (东财 secid 形如 1.BKxxxx)
  { code: '1.BK0438', symbol: 'BK0438', name: '电力设备', kind: 'industry' },
  { code: '1.BK0451', symbol: 'BK0451', name: '医药生物', kind: 'industry' },
  { code: '1.BK0420', symbol: 'BK0420', name: '食品饮料', kind: 'industry' },
  { code: '1.BK0421', symbol: 'BK0421', name: '纺织服饰', kind: 'industry' },
  { code: '1.BK0475', symbol: 'BK0475', name: '通信',     kind: 'industry' },
  { code: '1.BK0481', symbol: 'BK0481', name: '电子',     kind: 'industry' },
  { code: '1.BK0454', symbol: 'BK0454', name: '计算机',   kind: 'industry' },
  { code: '1.BK0473', symbol: 'BK0473', name: '传媒',     kind: 'industry' },
  { code: '1.BK0424', symbol: 'BK0424', name: '银行',     kind: 'industry' },
  { code: '1.BK0422', symbol: 'BK0422', name: '非银金融', kind: 'industry' }
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

// ---------- 纯函数: 解析东财 K 线 ----------

interface KLineRaw {
  klines?: unknown
}

export function parseEastmoneyKline(payload: unknown): number[] {
  if (!payload || typeof payload !== 'object') return []
  const klines = (payload as KLineRaw).klines
  if (!Array.isArray(klines)) return []
  const out: number[] = []
  for (const row of klines) {
    if (typeof row !== 'string') continue
    // "yyyy-MM-dd,open,close,high,low,vol,amount,pe_ttm" — 取第 8 列
    const cols = row.split(',')
    if (cols.length < 8) continue
    const pe = Number(cols[7])
    if (Number.isFinite(pe) && pe > 0) out.push(pe)
  }
  return out
}

// ---------- 纯函数: 解析东财单标的快照 ----------

export function parseEastmoneySnapshot(payload: unknown): { peTtm: number | null; pb: number | null } {
  if (!payload || typeof payload !== 'object') return { peTtm: null, pb: null }
  const data = (payload as { data?: Record<string, unknown> }).data
  if (!data || typeof data !== 'object') return { peTtm: null, pb: null }
  // f9 = PE-TTM (×100), f23 = PB (×100)
  const f9 = Number(data.f9)
  const f23 = Number(data.f23)
  return {
    peTtm: Number.isFinite(f9) && f9 > 0 ? f9 / 100 : null,
    pb: Number.isFinite(f23) && f23 > 0 ? f23 / 100 : null
  }
}

// ---------- 纯函数: 文本去除/过滤 (搜索用) ----------

export function matchesSearch(row: { name: string; code: string }, q: string): boolean {
  if (!q) return true
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return row.name.toLowerCase().includes(needle) || row.code.toLowerCase().includes(needle)
}

// ---------- JSONP 拉数 (浏览器) ----------

let _jsonpSeq = 0

interface JsonpOptions {
  timeoutMs?: number
}

function jsonp<T = unknown>(url: string, opts: JsonpOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 8000
  return new Promise<T>((resolve, reject) => {
    const cbName = `__valuation_jsonp_${Date.now()}_${++_jsonpSeq}`
    interface WindowWithCb { [k: string]: unknown }
    const w = window as unknown as WindowWithCb
    const cleanup = () => {
      try { delete w[cbName] } catch { w[cbName] = undefined }
      if (script.parentNode) script.parentNode.removeChild(script)
      clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('jsonp-timeout'))
    }, timeoutMs)
    w[cbName] = (data: T) => {
      cleanup()
      resolve(data)
    }
    const sep = url.includes('?') ? '&' : '?'
    const script = document.createElement('script')
    script.src = `${url}${sep}cb=${cbName}`
    script.onerror = () => {
      cleanup()
      reject(new Error('jsonp-error'))
    }
    document.body.appendChild(script)
  })
}

// ---------- 单标的拉取 ----------

const KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'
const SNAPSHOT_URL = 'https://push2.eastmoney.com/api/qt/stock/get'

async function fetchKline(symbol: ValuationSymbol, days = 2400): Promise<number[]> {
  const url = `${KLINE_URL}?secid=${encodeURIComponent(symbol.code)}&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=0&beg=0&end=20500101&lmt=${days}&_=${Date.now()}`
  const payload = await jsonp<unknown>(url, { timeoutMs: 8000 })
  const series = parseEastmoneyKline(payload)
  if (series.length === 0) throw new Error('kline-empty')
  return series
}

async function fetchSnapshot(symbol: ValuationSymbol): Promise<{ peTtm: number | null; pb: number | null }> {
  const url = `${SNAPSHOT_URL}?secid=${encodeURIComponent(symbol.code)}&fields=f43,f57,f58,f9,f23&_=${Date.now()}`
  const payload = await jsonp<unknown>(url, { timeoutMs: 5000 })
  const r = parseEastmoneySnapshot(payload)
  if (r.peTtm == null && r.pb == null) throw new Error('snapshot-fail')
  return r
}

/**
 * 拉取单标的完整估值行. 失败不抛, 写 failReason.
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
    // 并行拉快照 + K 线
    const [snap, kline] = await Promise.all([
      fetchSnapshot(symbol),
      fetchKline(symbol)
    ])
    const pct = computePercentile(kline, snap.peTtm)
    const bk = bucketByPercentile(pct)
    return {
      ...base,
      peTtm: snap.peTtm,
      pb: snap.pb,
      percentile: pct,
      bucket: bk.side,
      bucketLabel: bk.label,
      bucketAdvice: bk.advice,
      bucketTone: bk.tone
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return { ...base, failReason: msg }
  }
}
