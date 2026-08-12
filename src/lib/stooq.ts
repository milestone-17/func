/**
 * Stooq 免费历史行情 API 客户端
 * - 纳斯达克 100 ETF: QQQ.US
 * - 返回 daily CSV: Date,Open,High,Low,Close,Volume
 * - URL: https://stooq.com/q/d/l/?s=qqq.us&i=d&d1=YYYYMMDD&d2=YYYYMMDD
 *
 * 注意: stooq 不需要 key,但会有 CORS / 限流;在浏览器内通过 fetch 调用需要服务端代理或
 * 用户主动放行。这里实现一个轻客户端 + JSON 失败,失败时 UI 引导用户手填。
 */
export interface StooqBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const ENDPOINT = 'https://stooq.com/q/d/l/'

function formatYYYYMMDD(d: string): string {
  return d.replace(/-/g, '').slice(0, 8)
}

export function buildStooqUrl(symbol: string, from: string, to: string): string {
  const s = symbol.toLowerCase()
  return `${ENDPOINT}?s=${s}&i=d&d1=${formatYYYYMMDD(from)}&d2=${formatYYYYMMDD(to)}`
}

export function parseStooqCsv(text: string): StooqBar[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const header = lines[0].toLowerCase()
  if (!header.includes('date') || !header.includes('close')) {
    throw new Error('非预期 CSV 格式: ' + lines[0])
  }
  const bars: StooqBar[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 6) continue
    const [date, open, high, low, close, volume] = cols
    bars.push({
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume)
    })
  }
  return bars
}

export async function fetchStooqBars(
  symbol: string,
  from: string,
  to: string,
  fetcher: typeof fetch = fetch
): Promise<StooqBar[]> {
  const url = buildStooqUrl(symbol, from, to)
  const res = await fetcher(url)
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`)
  const text = await res.text()
  return parseStooqCsv(text)
}
