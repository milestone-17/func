/**
 * 中国场外基金净值拉取 (云端版)
 *
 * 全部经服务端代理 /api/market/fund-quotes (东财 FundMNFInfo, 服务端 60s 缓存):
 * - 浏览器不再 JSONP 直连 fundmobapi / pingzhongdata
 * - 解析函数 (parseFundMNFInfo 等) 保留导出, 服务端结构与前端类型一致, 单测继续覆盖
 * - fetchFundNavTrend 历史走势: 服务端暂无对应代理, 返回空数组 (详情页走势图降级)
 */

export interface FundNav {
  code: string
  name: string
  nav: number          // 元
  isEstimate: boolean  // 是否为估值 (用了 GSZ)
  navDate: string      // 净值日期 PDATE
  source: 'fundMNFInfo' | 'pingzhongdata'
}

import { api } from '@/lib/api'

let seq = 0

/** 解析 FundMNFInfo 响应 → Map<code, FundNav> (纯函数, 便于测试; 服务端代理同结构) */
export function parseFundMNFInfo(payload: unknown): Map<string, FundNav> {
  const map = new Map<string, FundNav>()
  if (!payload || typeof payload !== 'object') return map
  const datas = (payload as { Datas?: unknown[] }).Datas
  if (!Array.isArray(datas)) return map
  for (const d of datas) {
    if (!d || typeof d !== 'object') continue
    const obj = d as { FCODE?: unknown; SHORTNAME?: unknown; PDATE?: unknown; NAV?: unknown; GSZ?: unknown }
    const code = String(obj.FCODE ?? '').trim()
    if (!/^\d{6}$/.test(code)) continue
    const name = String(obj.SHORTNAME ?? '')
    const navDate = String(obj.PDATE ?? '')
    const nav = Number(obj.NAV)
    const gsz = Number(obj.GSZ)
    if (Number.isFinite(nav) && nav > 0) {
      map.set(code, { code, name, nav, isEstimate: false, navDate, source: 'fundMNFInfo' })
    } else if (Number.isFinite(gsz) && gsz > 0) {
      map.set(code, { code, name, nav: gsz, isEstimate: true, navDate, source: 'fundMNFInfo' })
    }
  }
  return map
}

/** 解析 pingzhongdata 的 Data_netWorthTrend → 最近净值 (元); 保留导出兼容旧测试 */
export function parsePingzhongDataTrend(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) return null
  for (let i = value.length - 1; i >= 0; i--) {
    const y = Number((value[i] as { y?: unknown } | null)?.y)
    if (Number.isFinite(y) && y > 0) return y
  }
  return null
}

/** JSONP 工具保留导出 (兼容旧测试/潜在调用方); 云端版主链路不再使用 */
export function jsonpGet(buildUrl: (cb: string) => string, timeout: number): Promise<unknown> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      resolve(null)
      return
    }
    const cb = `__fn_${Date.now()}_${++seq}`
    const w = window as unknown as Record<string, unknown>
    const script = document.createElement('script')
    let done = false
    const finish = (val: unknown) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { delete w[cb] } catch { w[cb] = undefined }
      script.remove()
      resolve(val)
    }
    const timer = setTimeout(() => finish(null), timeout)
    w[cb] = (data: unknown) => finish(data)
    script.onerror = () => finish(null)
    script.src = buildUrl(cb)
    document.body.appendChild(script)
  })
}

/** 批量拉取基金净值 (服务端代理); 失败返回空 Map, 不抛 */
export async function fetchFundNavs(codes: string[], timeout = 10000): Promise<Map<string, FundNav>> {
  void timeout
  const list = codes.filter(c => /^\d{6}$/.test(c))
  if (list.length === 0) return new Map()
  try {
    const r = await api.get<{ items: Array<{ code: string; name: string; nav: number; isEstimate: boolean; navDate: string; source: string }> }>(
      `/api/market/fund-quotes?codes=${list.join(',')}`
    )
    const map = new Map<string, FundNav>()
    for (const row of r.items) {
      map.set(row.code, { code: row.code, name: row.name, nav: row.nav, isEstimate: row.isEstimate, navDate: row.navDate, source: 'fundMNFInfo' })
    }
    return map
  } catch {
    return new Map()
  }
}

/** 兜底: 单只净值 (云端版统一走服务端代理, 保留旧签名) */
export async function fetchFundNavByPingzhongdata(code: string, timeout = 10000): Promise<FundNav | null> {
  void timeout
  return fetchFundQuote(code)
}

/** 单只基金净值拉取; 失败返回 null */
export async function fetchFundQuote(code: string, timeout = 8000): Promise<FundNav | null> {
  const map = await fetchFundNavs([code], timeout)
  return map.get(code) ?? null
}

export interface NavTrendPoint { date: string; nav: number }

/** 解析 pingzhongdata 完整历史 → [{date, nav}]; 保留导出兼容旧测试 */
export function parsePingzhongDataFullTrend(value: unknown): NavTrendPoint[] {
  if (!Array.isArray(value) || value.length === 0) return []
  const out: NavTrendPoint[] = []
  for (const r of value) {
    if (!r || typeof r !== 'object') continue
    const obj = r as { x?: unknown; y?: unknown }
    const x = Number(obj.x)
    const y = Number(obj.y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || y <= 0) continue
    const d = new Date(x)
    if (Number.isNaN(d.getTime())) continue
    out.push({
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
      nav: Math.round(y * 10000) / 10000
    })
  }
  return out
}

/** 拉取基金近 N 天净值历史 (云端版暂无服务端代理, 返回空数组降级) */
export async function fetchFundNavTrend(code: string, timeout = 12000): Promise<NavTrendPoint[]> {
  void code
  void timeout
  return []
}
