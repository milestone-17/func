/**
 * 中国场外基金净值/估值拉取 (东财移动端批量接口, JSONP 绕 CORS)
 *
 * 数据源: fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo
 *   - 支持 JSONP `callback` 参数, 回调名可自定义 → 无固定名串值问题
 *   - 一次请求返回全部 6 位基金代码的 Datas[]:
 *       FCODE      基金代码
 *       SHORTNAME  基金名称
 *       PDATE      净值日期
 *       NAV        最近交易日真实单位净值 (元)
 *       GSZ        盘中估值 (元), 交易时段外为 null
 *   - 取值优先级: NAV (真实净值) > GSZ (估值, 标 isEstimate)
 *
 * 兜底源: fund.eastmoney.com/pingzhongdata/{code}.js (脚本标签)
 *   设置全局 var Data_netWorthTrend = [{ x, y, ... }], 末元素 y 为最近净值 (元)。
 *   仅当批量接口失败时逐只使用 (该文件较大, ~281KB)。
 *
 * JSONP/脚本加载不受浏览器 CORS 限制, 线上 (GitHub Pages https) 可用。
 * 失败/超时 → 返回空 Map / null, 绝不写 0 或错误数值。
 */

export interface FundNav {
  code: string
  name: string
  nav: number          // 元
  isEstimate: boolean  // 是否为估值 (用了 GSZ)
  navDate: string      // 净值日期 PDATE (pingzhongdata 兜底时为空)
  source: 'fundMNFInfo' | 'pingzhongdata'
}

const MOBILE_API = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo'
const PINGZHONG_API = (code: string) =>
  `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js`

let seq = 0

/** 解析 FundMNFInfo 响应 → Map<code, FundNav> (纯函数, 便于测试) */
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

/** 解析 pingzhongdata 的 Data_netWorthTrend → 最近净值 (元); 无有效值返回 null */
export function parsePingzhongDataTrend(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) return null
  for (let i = value.length - 1; i >= 0; i--) {
    const y = Number((value[i] as { y?: unknown } | null)?.y)
    if (Number.isFinite(y) && y > 0) return y
  }
  return null
}

/** JSONP: 注入 script, 用唯一回调名拉取; 失败/超时 → null, 不抛 */
function jsonpGet(buildUrl: (cb: string) => string, timeout: number): Promise<unknown> {
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

/** 加载普通脚本 (不调用回调), 完成或失败返回布尔 */
function loadPlainScript(src: string, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      resolve(false)
      return
    }
    const script = document.createElement('script')
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      script.remove()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeout)
    script.onload = () => finish(true)
    script.onerror = () => finish(false)
    script.src = src
    document.body.appendChild(script)
  })
}

/** 批量拉取全部 6 位基金代码净值; 失败返回空 Map, 不抛 */
export async function fetchFundNavs(codes: string[], timeout = 10000): Promise<Map<string, FundNav>> {
  const list = codes.filter(c => /^\d{6}$/.test(c))
  if (list.length === 0) return new Map()
  const data = await jsonpGet((cb) => {
    const p = new URLSearchParams({
      pageIndex: '1',
      pageSize: String(Math.max(100, list.length)),
      plat: 'Android',
      appType: 'ttjj',
      product: 'EFund',
      Version: '1',
      deviceid: 'wxf',
    })
    // Fcodes 逗号拼接 (不编码逗号, 服务端按逗号拆)
    return `${MOBILE_API}?${p.toString()}&Fcodes=${list.join(',')}&callback=${cb}`
  }, timeout)
  return parseFundMNFInfo(data)
}

/** 兜底: pingzhongdata 逐只拉净值; 失败/超时 → null */
export async function fetchFundNavByPingzhongdata(code: string, timeout = 10000): Promise<FundNav | null> {
  const ok = await loadPlainScript(PINGZHONG_API(code), timeout)
  if (!ok) return null
  const nav = parsePingzhongDataTrend((window as { Data_netWorthTrend?: unknown }).Data_netWorthTrend)
  if (nav == null) return null
  return { code, name: '', nav, isEstimate: false, navDate: '', source: 'pingzhongdata' }
}

/** 单只基金净值拉取 (供单只手动刷新); 回调名唯一, 与批量并发不冲突 */
export async function fetchFundQuote(code: string, timeout = 8000): Promise<FundNav | null> {
  const map = await fetchFundNavs([code], timeout)
  return map.get(code) ?? null
}
