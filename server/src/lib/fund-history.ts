/**
 * 场外基金历史净值 + 搜索 (东财公开接口)
 * - 历史净值: api.fund.eastmoney.com/f10/lsjz (需 Referer)
 * - 搜索: fundsuggest.eastmoney.com FundSearchAPI
 * 全部服务端 HTTP 直连, 解析函数导出供单测
 */

const UA = { 'User-Agent': 'Mozilla/5.0 (func-server)' }
const F10_HEADERS = { ...UA, Referer: 'https://fundf10.eastmoney.com/' }

export interface FundHistoryBar { date: string; nav: number; accNav?: number }

/** 解析 f10/lsjz 列表 */
export function parseLsjzList(payload: unknown): FundHistoryBar[] {
  const list = (payload as { Data?: { LSJZList?: unknown[] } } | null)?.Data?.LSJZList
  if (!Array.isArray(list)) return []
  const out: FundHistoryBar[] = []
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const o = r as { FSRQ?: unknown; DWJZ?: unknown; LJJZ?: unknown }
    const date = String(o.FSRQ || '')
    const nav = Number(o.DWJZ)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(nav) || nav <= 0) continue
    const accNav = Number(o.LJJZ)
    out.push({
      date,
      nav: Math.round(nav * 10000) / 10000,
      accNav: Number.isFinite(accNav) && accNav > 0 ? Math.round(accNav * 10000) / 10000 : undefined
    })
  }
  return out
}

/** 拉取基金全部历史净值 (翻页至上限; 东财实际每页仅回 ~20 条与 pageSize 无关, 以空页为终止) */
export async function fetchFundHistoryFromEm(code: string): Promise<FundHistoryBar[]> {
  const all: FundHistoryBar[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= 60; page++) {
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${page}&pageSize=49`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const res = await fetch(url, { headers: F10_HEADERS, signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const list = parseLsjzList(json)
      if (list.length === 0) break
      let fresh = 0
      for (const b of list) {
        if (!seen.has(b.date)) {
          seen.add(b.date)
          all.push(b)
          fresh++
        }
      }
      // 整页都是重复数据 → 已到最早记录
      if (fresh === 0) break
    } finally {
      clearTimeout(timer)
    }
  }
  // 接口返回为倒序 → 升序
  return all.reverse()
}

export interface FundSearchItem { code: string; name: string; type: string }

/** 解析 FundSearchAPI */
export function parseFundSearch(payload: unknown): FundSearchItem[] {
  const datas = (payload as { Datas?: unknown[] } | null)?.Datas
  if (!Array.isArray(datas)) return []
  const out: FundSearchItem[] = []
  for (const d of datas) {
    if (!d || typeof d !== 'object') continue
    const o = d as { CODE?: unknown; NAME?: unknown; FundBaseInfo?: { FT?: unknown; JJGS?: unknown } }
    const code = String(o.CODE || '')
    if (!/^\d{6}$/.test(code)) continue
    const name = String(o.NAME || '').replace(/<[^>]+>/g, '')
    const ft = String(o.FundBaseInfo?.FT ?? '')
    const type = ft || '基金'
    out.push({ code, name, type })
  }
  return out
}

export async function searchFundsFromEm(key: string): Promise<FundSearchItem[]> {
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(key)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    return parseFundSearch(json).slice(0, 10)
  } finally {
    clearTimeout(timer)
  }
}
