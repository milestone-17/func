/**
 * 天天基金估值备源 (东财 FundMNFInfo 失败时兜底)
 *   GET https://fundgz.1234567.com.cn/js/{code}.js?rt=timestamp
 *   响应: jsonpgz({"fundcode":"000001","name":"华夏成长","jz4":"1.2340","gsz":"1.2500","gszzl":"1.30","gztime":"2026-10-06 15:00"});
 */
import { curlFetch } from './quote-fetch'

export interface FundGzRow {
  fundcode?: string
  name?: string
  jz4?: string
  gsz?: string
  gszzl?: string
  gztime?: string
}

/** jsonpgz({...}) 文本 → 对象 */
export function parseFundgzText(text: string): FundGzRow | null {
  const m = text.match(/jsonpgz\((\{[\s\S]*\})\)/)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as FundGzRow
  } catch {
    return null
  }
}

interface FundQuoteRowLike {
  code: string
  name: string
  nav: number
  isEstimate: boolean
  navDate: string
  source: string
}

const CONCURRENCY = 5

/** 逐代码抓取 fundgz (并发 5), 优先最新净值 jz4, 否则估值 gsz */
export async function fetchFundQuotesFromFundgz(codes: string[]): Promise<FundQuoteRowLike[]> {
  const out: FundQuoteRowLike[] = []
  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async (code): Promise<FundQuoteRowLike | null> => {
      try {
        const buf = await curlFetch(`https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`, { timeoutSec: 15, retries: 1 })
        const gz = parseFundgzText(buf.toString('utf8'))
        if (!gz) return null
        const jz4 = Number(gz.jz4)
        const gsz = Number(gz.gsz)
        const gzDate = (gz.gztime || '').slice(0, 10)
        if (Number.isFinite(jz4) && jz4 > 0) {
          return { code, name: gz.name || code, nav: jz4, isEstimate: false, navDate: gzDate, source: 'fundgz' }
        }
        if (Number.isFinite(gsz) && gsz > 0) {
          return { code, name: gz.name || code, nav: gsz, isEstimate: true, navDate: gzDate, source: 'fundgz' }
        }
        return null
      } catch {
        return null
      }
    }))
    for (const r of results) if (r) out.push(r)
  }
  return out
}
