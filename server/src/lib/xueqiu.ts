/**
 * 雪球行情源 (独立第四源, 覆盖 A股/ETF/美股/指数 报价+日K)
 *   - 雪球要求首访 cookie (xq_a_token 等): 先 GET xueqiu.com/hq 引导, 失败丢弃旧 cookie 重引导
 *   - 请求经 curl -4 (与 live-quote 同栈, 服务器 IPv6 出口被部分源重置)
 *   - 解析函数纯导出, 供单测
 */
import { curlFetch } from './quote-fetch'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const COOKIE_TTL = 10 * 24 * 3600_000 // cookie 一般 10 天有效

interface XqCookie { cookie: string; fetchedAt: number }
let xqCookie: XqCookie | null = null

/** symbol → 雪球格式: 6位数字按沪Sh/Sz 推断, 字母(美股)原样, .NDX 等指数带点 */
export function xqSymbolOf(code: string): string {
  if (/^\d{6}$/.test(code)) {
    return /^[569]/.test(code) ? `SH${code}` : `SZ${code}`
  }
  if (/^\.[A-Z]/.test(code)) return code // .NDX/.SPX 指数
  return code.toUpperCase()
}

// ------------------------------------------------------------ 解析 (纯函数)

export interface XqQuote { code: string; name: string; price: number; source: 'xueqiu'; time: number }

/** quote.json 单条 → LiveQuote 形态 */
export function parseXqQuote(json: unknown, code: string): XqQuote | null {
  const q = (json as { data?: { quote?: Record<string, unknown> } } | null)?.data?.quote
  if (!q) return null
  const price = Number(q.current ?? q.current_ext)
  const name = String(q.name || '').trim()
  if (!name || !Number.isFinite(price) || price <= 0) return null
  return { code: code.toUpperCase(), name, price, source: 'xueqiu', time: Date.now() }
}

export interface XqBar { date: string; close: number }

/** kline.json → bars (行主序: item 为行数组, 每行按 column 取值; 升序输出) */
export function parseXqKline(json: unknown): XqBar[] {
  const data = (json as { data?: { column?: unknown; item?: unknown } } | null)?.data
  if (!data || !Array.isArray(data.column) || !Array.isArray(data.item)) return []
  const col = data.column as string[]
  const tIdx = col.indexOf('timestamp')
  const cIdx = col.indexOf('close')
  if (tIdx < 0 || cIdx < 0) return []
  const bars: XqBar[] = []
  for (const row of data.item as unknown[]) {
    if (!Array.isArray(row) || row.length <= Math.max(tIdx, cIdx)) continue
    const t = Number(row[tIdx])
    const c = Number(row[cIdx])
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(c) || c <= 0) continue
    const d = new Date(t)
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    bars.push({ date, close: Math.round(c * 100) / 100 })
  }
  return bars
}

// ------------------------------------------------------------ cookie 引导

/** 从 Set-Cookie 响应头风格文本中提取 cookie 键值对 (curl -c 格式) */
export function parseCookieJar(text: string): string {
  const pairs: string[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    // #HttpOnly_ 前缀是合法数据行 (curl jar 约定), 仅跳过真注释 (# + 空格/纯#)
    const data = /^#HttpOnly_/.test(line) ? line.slice('#HttpOnly_'.length) : line
    if (/^#/.test(data)) continue
    const parts = data.split('\t')
    if (parts.length < 7) continue
    const name = (parts[5] || '').trim()
    const value = (parts[6] || '').trim()
    if (name && value) pairs.push(`${name}=${value}`)
  }
  return pairs.join('; ')
}

const JAR_TMP = `/tmp/xq-cookie-${process.pid}.jar`

async function bootstrapCookie(): Promise<string> {
  // curlFetch 不透出响应头 → 用 curl -c 把 Set-Cookie 写入 jar 文件再解析
  const buf = await curlFetch('https://xueqiu.com/hq', {
    headers: [`User-Agent: ${UA}`],
    timeoutSec: 10,
    curlArgs: ['-c', JAR_TMP]
  })
  void buf
  const fs = await import('node:fs')
  let jar = ''
  try {
    jar = parseCookieJar(fs.readFileSync(JAR_TMP, 'utf8'))
  } catch { /* jar 未生成 */ }
  if (!jar.includes('xq_a_token')) throw new Error('雪球 cookie 引导失败 (无 xq_a_token)')
  return jar
}

async function getXqCookie(force = false): Promise<string> {
  if (!force && xqCookie && Date.now() - xqCookie.fetchedAt < COOKIE_TTL) return xqCookie.cookie
  const cookie = await bootstrapCookie()
  xqCookie = { cookie, fetchedAt: Date.now() }
  return cookie
}

/** 带cookie 的雪球 GET; 400016 (token 失效) 自动重引导重试一次 */
async function xqGetJson<T>(url: string): Promise<T> {
  const once = async (): Promise<T> => {
    const cookie = await getXqCookie()
    const buf = await curlFetch(url, {
      headers: [`User-Agent: ${UA}`, `Cookie: ${cookie}`, 'Accept: application/json'],
      timeoutSec: 12
    })
    return JSON.parse(buf.toString('utf8')) as T
  }
  try {
    return await once()
  } catch {
    // cookie 过期 → 强制重引导一次
    await getXqCookie(true)
    return once()
  }
}

// ------------------------------------------------------------ 对外接口

/** 雪球实时报价 (单/批量; 返回 null 表示不可用, 调用方兜底) */
export async function fetchXqQuotes(codes: string[]): Promise<XqQuote[]> {
  const out: XqQuote[] = []
  for (const code of codes) {
    try {
      const sym = xqSymbolOf(code)
      const json = await xqGetJson<unknown>(`https://stock.xueqiu.com/v5/stock/quote.json?symbol=${sym}&extend=detail`)
      const q = parseXqQuote(json, code)
      if (q) out.push(q)
    } catch { /* 单只失败不影响其余 */ }
  }
  return out
}

/** 雪球日K (count 负数=最近 n 根; type=before 前复权) */
export async function fetchXqDailyBars(code: string, count = 500): Promise<XqBar[]> {
  const sym = xqSymbolOf(code)
  const begin = Date.now() + 24 * 3600_000 // 含今日
  const json = await xqGetJson<unknown>(
    `https://stock.xueqiu.com/v5/stock/chart/kline.json?symbol=${sym}&begin=${begin}&period=day&type=before&count=-${count}`
  )
  return parseXqKline(json)
}
