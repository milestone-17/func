/**
 * 行情抓取器 (东方财富公开接口, 国内服务器直连稳定)
 *
 * 指数日线: push2his klt=101 日K
 *   - ^NDX  → secid 105.NDX (纳斯达克100)
 *   - ^GSPC → secid 100.GSPC (标普500)
 * 输出结构与旧 Yahoo 版一致: [{ symbol, date, data: {symbol,name,date,close} }]
 */

const INDICES = [
  { secid: '100.NDX', symbol: '^NDX', name: '纳斯达克100指数' },
  { secid: '100.SPX', symbol: '^GSPC', name: '标普500指数' }
]

const UT = 'fa5fd1943c7b386f172d6893dbfba10b'

interface Bar { date: string; close: number }

/** 解析 push2his klines ["2026-01-05,开,收,高,低,..."] → bars (升序) */
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

async function fetchIndex(idx: { secid: string; symbol: string; name: string }): Promise<Array<{ symbol: string; date: string; data: object }>> {
  // lmt=600 ≈ 2.4 年交易日, 覆盖 2y 需求
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(idx.secid)}&klt=101&fqt=1&lmt=600&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55&ut=${UT}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (func-server)' } })
  if (!res.ok) throw new Error(`东财 HTTP ${res.status} for ${idx.symbol}`)
  const json = (await res.json()) as { data?: { klines?: unknown } }
  const bars = parseEmKlines(json?.data?.klines)
  if (bars.length < 250) throw new Error(`${idx.symbol} 数据不足: 仅 ${bars.length} 条`)
  return bars.map(b => ({
    symbol: idx.symbol,
    date: b.date,
    data: { symbol: idx.symbol, name: idx.name, date: b.date, close: b.close }
  }))
}

export async function fetchAllIndices(): Promise<Array<{ symbol: string; date: string; data: object }>> {
  const out: Array<{ symbol: string; date: string; data: object }> = []
  for (const idx of INDICES) {
    try {
      const rows = await fetchIndex(idx)
      out.push(...rows)
    } catch (e) {
      console.warn(`[market] ${idx.symbol} 抓取失败: ${(e as Error).message}`)
    }
  }
  return out
}
