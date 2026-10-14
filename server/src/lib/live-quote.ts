/**
 * 实时行情多源抓取 (新浪主 → 腾讯备 → 东财兜底 → 雪球终备)
 *   - 逐源批量请求, 命中代码不再进后续源
 *   - 新浪/腾讯走 quote-fetch.ts 的 curl -4 客户端 (服务器 IPv6 出口被部分源重置);
 *     东财 push2 对 curl 指纹掐断连接 (52 Empty reply), 用 node fetch 直连
 *   - 新浪/腾讯 GBK 编码用 iconv-lite 解码
 *   - markSourceHealth/getSourceHealth: 供健康状态展示
 */
import * as iconv from 'iconv-lite'
import { curlFetch, fetchQuoteJsonDirect } from './quote-fetch'
import { fetchXqQuotes } from './xueqiu'

export interface LiveQuote {
  code: string
  name: string
  price: number
  source: string
  time: number
}

export interface LiveQuoteResult {
  items: LiveQuote[]
  missing: string[]
}

// ------------------------------------------------------------ 健康状态

interface SourceHealth { lastOkAt: number | null; lastFailAt: number | null; failStreak: number }
const healthMap = new Map<string, SourceHealth>()

/** 记录某源一次成功/失败 (供健康状态展示) */
export function markSourceHealth(source: string, ok: boolean): void {
  let h = healthMap.get(source)
  if (!h) {
    h = { lastOkAt: null, lastFailAt: null, failStreak: 0 }
    healthMap.set(source, h)
  }
  if (ok) {
    h.lastOkAt = Date.now()
    h.failStreak = 0
  } else {
    h.lastFailAt = Date.now()
    h.failStreak += 1
  }
}

export function getSourceHealth(): Record<string, { lastOkAt: number | null; lastFailAt: number | null; failStreak: number }> {
  const out: Record<string, { lastOkAt: number | null; lastFailAt: number | null; failStreak: number }> = {}
  for (const [k, v] of healthMap) out[k] = { ...v }
  return out
}

// ------------------------------------------------------------ 代码映射

const SH_ETF_PREFIXES = ['510', '511', '512', '513', '515', '518', '560', '561', '562', '563', '588']

/** 6 位数字代码 → 新浪市场前缀 (sh/sz), 返回 null 表示非 6 位 */
function sinaPrefixOf(code: string): string | null {
  if (!/^\d{6}$/.test(code)) return null
  if (SH_ETF_PREFIXES.some(p => code.startsWith(p))) return 'sh'
  return /^[569]/.test(code) ? 'sh' : 'sz'
}

/** 字母代码 (美股/港美股) */
function isLetterCode(code: string): boolean {
  return /^[A-Za-z][A-Za-z.\-]{0,9}$/.test(code)
}

/** 宽松校验: 6 位数字或字母代码 */
export function isValidLiveCode(code: string): boolean {
  return /^\d{6}$/.test(code) || isLetterCode(code)
}

/** 代码规范化: 字母统一大写 (新浪/腾讯源内部再各自转小写) */
function normCode(c: string): string {
  return c.trim().toUpperCase()
}

// ------------------------------------------------------------ 新浪 (主源)

/** 新浪 GBK 文本解析: var hq_str_sh510300="沪深300ETF,..." */
export function parseSinaText(text: string, wantCodes: string[]): LiveQuote[] {
  const byVar: Record<string, string[]> = {}
  for (const m of text.matchAll(/hq_str_([A-Za-z0-9_]+)="([^"]*)"/g)) {
    byVar[m[1].toLowerCase()] = m[2].split(',')
  }
  const out: LiveQuote[] = []
  for (const code of wantCodes) {
    const c = code.toLowerCase()
    let fields: string[] | undefined
    if (/^\d{6}$/.test(c)) {
      const prefix = sinaPrefixOf(c)
      fields = prefix ? byVar[prefix + c] : undefined
      if (!fields?.length) fields = byVar[c] // 兜底: 无前缀变量
    } else {
      fields = byVar['gb_' + c]
    }
    if (!fields || fields.length < 2) continue
    const name = (fields[0] || '').trim()
    // A股/ETF: 3=最新价; 美股 gb_: 1=最新价
    const price = Number(/^\d{6}$/.test(c) ? fields[3] : fields[1])
    if (!name || !Number.isFinite(price) || price <= 0) continue
    out.push({ code: code.toUpperCase(), name, price, source: 'sina', time: Date.now() })
  }
  return out
}

async function fromSina(codes: string[]): Promise<LiveQuote[]> {
  const query = codes.map(c => (/^\d{6}$/.test(c) ? sinaPrefixOf(c) + c : 'gb_' + c.toLowerCase())).join(',')
  const buf = await curlFetch('https://hq.sinajs.cn/list=' + query, {
    headers: ['Referer: https://finance.sina.com.cn']
  })
  const text = iconv.decode(buf, 'gbk')
  return parseSinaText(text, codes)
}

// ------------------------------------------------------------ 腾讯 (备源)

/** 腾讯 GBK 文本解析: v_sh600519="1~贵州茅台~600519~1234.50~..." */
export function parseTencentText(text: string, wantCodes: string[]): LiveQuote[] {
  const byKey: Record<string, string[]> = {}
  for (const m of text.matchAll(/v_([A-Za-z0-9]+)="([^"]*)"/g)) {
    byKey[m[1].toLowerCase()] = m[2].split('~')
  }
  const out: LiveQuote[] = []
  for (const code of wantCodes) {
    const c = code.toLowerCase()
    let fields: string[] | undefined
    if (/^\d{6}$/.test(c)) {
      fields = byKey[c] || byKey['sh' + c] || byKey['sz' + c]
    } else {
      fields = byKey['us' + c]
    }
    if (!fields || fields.length < 4) continue
    const name = (fields[1] || '').trim()
    const price = Number(fields[3])
    if (!name || !Number.isFinite(price) || price <= 0) continue
    out.push({ code: code.toUpperCase(), name, price, source: 'tencent', time: Date.now() })
  }
  return out
}

async function fromTencent(codes: string[]): Promise<LiveQuote[]> {
  const query = codes.map(c => (/^\d{6}$/.test(c) ? (sinaPrefixOf(c) || 'sh') + c : 'us' + c.toLowerCase())).join(',')
  const buf = await curlFetch('https://qt.gtimg.cn/q=' + query)
  const text = iconv.decode(buf, 'gbk')
  return parseTencentText(text, codes)
}

// ------------------------------------------------------------ 东财 (兜底)

/** 东财 secid: 沪 1. / 深 0., 与新浪前缀同规则; 美股 105.(纳市) */
function emSecidOf(code: string): string | null {
  if (!/^\d{6}$/.test(code)) return '105.' + code.toUpperCase()
  return sinaPrefixOf(code) === 'sh' ? '1.' + code : '0.' + code
}

/** 东财 ulist JSON → LiveQuote[] (f2 价格×100 修正) */
export function parseEmUlist(json: unknown, wantCodes: string[]): LiveQuote[] {
  const diff = (json as { data?: { diff?: Array<Record<string, unknown>> } } | null)?.data?.diff
  if (!Array.isArray(diff)) return []
  const byCode: Record<string, Record<string, unknown>> = {}
  for (const d of diff) {
    const code = String(d.f12 || '').trim().toUpperCase()
    if (code) byCode[code] = d
  }
  const out: LiveQuote[] = []
  for (const code of wantCodes) {
    const d = byCode[code.toUpperCase()]
    if (!d) continue
    let price = Number(d.f2)
    if (!Number.isFinite(price) || price <= 0) continue
    if (Math.abs(price) >= 10000) price = price / 100 // f2 为分单位时修正为元 (回包恒为整数分)
    const name = String(d.f14 || '').trim()
    if (!name) continue
    out.push({ code: code.toUpperCase(), name, price, source: 'eastmoney-push2', time: Date.now() })
  }
  return out
}

async function fromEastmoney(codes: string[]): Promise<LiveQuote[]> {
  const secids = codes.map(emSecidOf).filter(s => s !== null).join(',')
  const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=' + encodeURIComponent(secids)
    + '&fields=f2,f3,f12,f14&fltt=2&ut=fa5fd1943c7b386f172d6893dbfba10b'
  // push2 WAF 对服务器出口 curl -4 指纹直接掐断 → node fetch 实测可直连
  return parseEmUlist(await fetchQuoteJsonDirect<unknown>(url), codes)
}

// ------------------------------------------------------------ 主入口

/** 逐源批量抓取: 新浪 → 腾讯 → 东财, 命中即止 */
export async function fetchLiveQuotes(codes: string[]): Promise<LiveQuoteResult> {
  const want = [...new Set(codes.map(normCode).filter(isValidLiveCode))]
  const remaining = new Set(want)
  const items: LiveQuote[] = []

  const sources: Array<{ id: string; fetch: (cs: string[]) => Promise<LiveQuote[]> }> = [
    { id: 'sina', fetch: fromSina },
    { id: 'tencent', fetch: fromTencent },
    { id: 'eastmoney-push2', fetch: fromEastmoney },
    { id: 'xueqiu', fetch: (cs) => fetchXqQuotes(cs) as Promise<LiveQuote[]> }
  ]

  for (const src of sources) {
    if (!remaining.size) break
    const batch = [...remaining]
    let got: LiveQuote[] = []
    try {
      got = await src.fetch(batch)
      markSourceHealth(src.id, true)
    } catch {
      markSourceHealth(src.id, false)
    }
    for (const q of got) {
      if (remaining.has(q.code)) {
        remaining.delete(q.code)
        items.push(q)
      }
    }
  }

  return { items, missing: [...remaining] }
}
