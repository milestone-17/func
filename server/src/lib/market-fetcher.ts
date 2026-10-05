/**
 * 行情抓取器 (腾讯行情公开接口, 国内服务器直连稳定)
 *
 * 指数日线: web.ifzq.gtimg.cn newfqkline 日K (qfq)
 *   - ^NDX  → usNDX (纳斯达克100)
 *   - ^GSPC → usINX (标普500)
 * 注: 东财 100.NDX 实为纳斯达克综合指数 (口径不符), 100.NDX100 无K线数据, 故弃用东财美股指数
 * 输出结构与旧版一致: [{ symbol, date, data: {symbol,name,date,close} }]
 */

const INDICES = [
  { code: 'usNDX', symbol: '^NDX', name: '纳斯达克100指数' },
  { code: 'usINX', symbol: '^GSPC', name: '标普500指数' }
]

interface Bar { date: string; close: number }

/** 解析腾讯 newfqkline 响应 → bars (升序); 行格式 [date, open, close, high, low, volume] */
export function parseTencentKlines(payload: unknown): Bar[] {
  const data = (payload as { data?: Record<string, { qfqday?: unknown; day?: unknown }> } | null)?.data
  if (!data || typeof data !== 'object') return []
  const keys = Object.keys(data)
  if (!keys.length) return []
  const node = (data as Record<string, { qfqday?: unknown; day?: unknown }>)[keys[0]]
  const rows = (node?.qfqday || node?.day) as unknown
  if (!Array.isArray(rows)) return []
  const bars: Bar[] = []
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 3) continue
    const date = String(r[0] || '')
    const close = Number(r[2])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
    bars.push({ date, close: Math.round(close * 100) / 100 })
  }
  return bars
}

async function fetchIndex(idx: { code: string; symbol: string; name: string }): Promise<Array<{ symbol: string; date: string; data: object }>> {
  // 660 根日K ≈ 2.6 年, 覆盖 MA250 与 2y 需求
  const url = `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${idx.code},day,,,660,qfq`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (func-server)' } })
  if (!res.ok) throw new Error(`腾讯 HTTP ${res.status} for ${idx.symbol}`)
  const json = await res.json()
  const bars = parseTencentKlines(json)
  if (bars.length < 400) throw new Error(`${idx.symbol} 数据不足: 仅 ${bars.length} 条`)
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
