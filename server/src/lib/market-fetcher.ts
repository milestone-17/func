const INDICES = [
  { yahoo: '%5ENDX', symbol: '^NDX', name: '纳斯达克100指数' },
  { yahoo: '%5EGSPC', symbol: '^GSPC', name: '标普500指数' }
]

interface Bar { date: string; close: number }

function tsToDate(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

async function fetchIndex(idx: { yahoo: string; symbol: string; name: string }): Promise<Array<{ symbol: string; date: string; data: object }>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${idx.yahoo}?range=2y&interval=1d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (func-server)' } })
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${idx.symbol}`)
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result || !result.timestamp) throw new Error(`Yahoo 返回数据结构异常: ${idx.symbol}`)
  const ts: number[] = result.timestamp
  const closes: Array<number | null> = result.indicators?.quote?.[0]?.close || []
  const bars: Bar[] = []
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i]
    if (c == null || Number.isNaN(c)) continue
    bars.push({ date: tsToDate(ts[i]), close: Math.round(c * 100) / 100 })
  }
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
