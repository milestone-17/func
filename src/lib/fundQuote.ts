/**
 * 中国场外基金净值/估值拉取 (JSONP, 绕过浏览器 CORS)
 *
 * 数据源: 天天基金 fundgz.1234567.com.cn
 *   返回形如: jsonpgz({"fundcode":"006260","name":"...","jzrq":"2026-08-12",
 *            "dwjz":"1.2345","gsz":"1.24","gszzl":"0.8","gztime":"2026-08-13 15:00"});
 *   - dwjz:  最近一个交易日的真实单位净值 (元)
 *   - gsz:   盘中估算净值 (元)
 *   - gszzl: 估算涨跌幅 (%)
 *
 * JSONP 走 <script> 标签, 不受 CORS 限制, 线上(GitHub Pages)可用。
 * 回调名固定 jsonpgz, 并发会串值 → 调用方逐只串行拉取。
 * 失败/超时/无数据 → 返回 null, 绝不返回 0 或错误值。
 */

export interface FundQuote {
  code: string
  name: string
  nav: number          // 单位净值 (元), 优先 dwjz
  isEstimate: boolean  // 是否为估算值 (用了 gsz)
  navDate: string      // 净值日期 (jzrq) 或估算时间 (gztime)
  source: 'fundgz'
}

/** 解析 fundgz 返回的数据对象 (纯函数, 便于测试) */
export function parseFundGz(data: unknown): FundQuote | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const code = String(d.fundcode ?? '')
  const name = String(d.name ?? '')
  const dwjz = Number(d.dwjz)
  const gsz = Number(d.gsz)
  // 优先真实单位净值 dwjz
  if (Number.isFinite(dwjz) && dwjz > 0) {
    return { code, name, nav: dwjz, isEstimate: false, navDate: String(d.jzrq ?? ''), source: 'fundgz' }
  }
  // 回退估算值 gsz
  if (Number.isFinite(gsz) && gsz > 0) {
    return { code, name, nav: gsz, isEstimate: true, navDate: String(d.gztime ?? ''), source: 'fundgz' }
  }
  return null
}

/** 用 JSONP 拉取一只基金净值; 失败/超时返回 null, 绝不抛出 */
export function fetchFundQuote(code: string, timeout = 8000): Promise<FundQuote | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      resolve(null) // 非浏览器环境
      return
    }
    let done = false
    const script = document.createElement('script')

    const cleanup = (val: FundQuote | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { delete (window as any).jsonpgz } catch { (window as any).jsonpgz = undefined }
      script.remove()
      resolve(val)
    }
    const timer = setTimeout(() => cleanup(null), timeout)

    ;(window as any).jsonpgz = (data: unknown) => cleanup(parseFundGz(data))
    script.onerror = () => cleanup(null)
    script.src = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js?rt=${Date.now()}`
    document.body.appendChild(script)
  })
}
