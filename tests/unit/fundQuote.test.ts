import { describe, it, expect, afterEach, vi } from 'vitest'
import { fetchFundNavs, fetchFundQuote, parseFundMNFInfo } from '@/lib/fundQuote'

const MNF_ROWS = {
  items: [
    { code: '006260', name: '华夏纳斯达克100ETF联接', nav: 1.7811, isEstimate: false, navDate: '2026-01-02', source: 'fundMNFInfo' },
    { code: '019261', name: '天弘纳斯达克100指数A', nav: 1.2345, isEstimate: false, navDate: '2026-01-02', source: 'fundMNFInfo' }
  ]
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseFundMNFInfo (纯函数, 服务端同结构)', () => {
  it('解析 Datas → Map', () => {
    const payload = {
      Datas: [
        { FCODE: '006260', SHORTNAME: '华夏纳斯达克100ETF联接', PDATE: '2026-01-02', NAV: '1.7811', GSZ: '' },
        { FCODE: '019261', SHORTNAME: '天弘纳斯达克100指数A', PDATE: '2026-01-02', NAV: '', GSZ: '1.1000' }
      ]
    }
    const m = parseFundMNFInfo(payload)
    expect(m.get('006260')?.nav).toBe(1.7811)
    expect(m.get('006260')?.isEstimate).toBe(false)
    expect(m.get('019261')?.nav).toBe(1.1)
    expect(m.get('019261')?.isEstimate).toBe(true)
  })

  it('非法载荷 → 空 Map', () => {
    expect(parseFundMNFInfo(null).size).toBe(0)
    expect(parseFundMNFInfo({}).size).toBe(0)
  })
})

describe('fetchFundNavs (云端: 服务端代理)', () => {
  it('调 /api/market/fund-quotes 并解析 items', async () => {
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      calledUrl = String(url)
      return { ok: true, status: 200, json: async () => MNF_ROWS } as unknown as Response
    }))
    const m = await fetchFundNavs(['006260', '019261'])
    expect(calledUrl).toContain('/api/market/fund-quotes')
    expect(calledUrl).toContain('codes=006260,019261')
    expect(m.get('006260')?.nav).toBe(1.7811)
    expect(m.get('019261')?.nav).toBe(1.2345)
  })

  it('接口失败 → 空 Map, 不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const m = await fetchFundNavs(['006260'])
    expect(m.size).toBe(0)
  })

  it('非法代码被过滤', async () => {
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      calledUrl = String(url)
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response
    }))
    await fetchFundNavs(['abc', '006260'])
    expect(calledUrl).toContain('codes=006260')
  })
})

describe('fetchFundQuote (单只)', () => {
  it('复用批量接口, 取单只', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => MNF_ROWS }) as unknown as Response
    ))
    const nav = await fetchFundQuote('006260')
    expect(nav?.nav).toBe(1.7811)
  })

  it('无数据 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ items: [] }) }) as unknown as Response
    ))
    const nav = await fetchFundQuote('999999')
    expect(nav).toBeNull()
  })
})
