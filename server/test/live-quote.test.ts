/**
 * 实时行情三源抓取单测 (mock curlFetch/fetchQuoteJsonDirect, 不发真实请求)
 *   - 新浪命中 → 不再请求后续源
 *   - 新浪抛错/空 → 腾讯命中
 *   - 价格<=0 → 视为未命中继续下一源
 *   - 三源全未命中 → missing
 *   - markSourceHealth 状态机
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import iconv from 'iconv-lite'

const curlFetchMock = vi.hoisted(() => vi.fn())
const directMock = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/quote-fetch', () => ({
  curlFetch: curlFetchMock,
  fetchQuoteJson: vi.fn(),
  fetchQuoteJsonDirect: directMock
}))

import {
  fetchLiveQuotes, markSourceHealth, getSourceHealth,
  parseSinaText, parseTencentText, parseEmUlist
} from '../src/lib/live-quote'

const gbk = (s: string): Buffer => iconv.encode(s, 'gbk')

const SINA_MOUTAI = '贵州茅台,600519,1,1490.00,1491.00,1490.50,120000,...'
const TX_MOUTAI = '1~贵州茅台~600519~1490.00~1491.00~1490.50~120000~...~20261006'
const sinaBody = (rows: Array<[string, string]>): string =>
  rows.map(([k, v]) => `var hq_str_${k}="${v}";`).join('\n')
const tencentBody = (rows: Array<[string, string]>): string =>
  rows.map(([k, v]) => `v_${k}="${v}"`).join(';') + ';'

describe('解析器纯函数', () => {
  it('parseSinaText: A股取 index3, 美股 gb_ 取 index1', () => {
    const text = sinaBody([
      ['sh600519', SINA_MOUTAI],
      ['gb_qqq', 'Invesco QQQ Trust,489.25,2026-10-03,490.00,...']
    ])
    const r = parseSinaText(text, ['600519', 'QQQ'])
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ code: '600519', name: '贵州茅台', price: 1490.0, source: 'sina' })
    expect(r[1]).toMatchObject({ code: 'QQQ', name: 'Invesco QQQ Trust', price: 489.25, source: 'sina' })
  })

  it('parseSinaText: 价格<=0/字段缺失 丢弃', () => {
    const text = sinaBody([['sz000651', '格力电器,000651,1,0.00,...']])
    expect(parseSinaText(text, ['000651'])).toHaveLength(0)
  })

  it('parseTencentText: split(~) index1 名称 index3 价格', () => {
    const r = parseTencentText(tencentBody([['sh600519', TX_MOUTAI]]), ['600519'])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ code: '600519', name: '贵州茅台', price: 1490.0, source: 'tencent' })
  })

  it('parseEmUlist: f2 为分单位 (>=10000) 除以 100; 缺 f14 丢弃', () => {
    const json = { data: { diff: [
      { f2: 149000, f3: 1.2, f12: '600519', f14: '贵州茅台' },
      { f2: 12.34, f3: -0.5, f12: '000651', f14: '格力电器' },
      { f2: 100, f3: 0, f12: '510300', f14: '' }
    ] } }
    const r = parseEmUlist(json, ['600519', '000651', '510300'])
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ code: '600519', price: 1490.0, source: 'eastmoney-push2' })
    expect(r[1]).toMatchObject({ code: '000651', price: 12.34 })
  })
})

describe('fetchLiveQuotes 多源兜底', () => {
  beforeEach(() => {
    curlFetchMock.mockReset()
    directMock.mockReset()
    directMock.mockResolvedValue({ data: { diff: [] } }) // 东财默认空回包
  })

  it('新浪命中 → source=sina, 不再请求腾讯/东财 (带 Referer)', async () => {
    curlFetchMock.mockImplementation(async () => gbk(sinaBody([['sh600519', SINA_MOUTAI]])))
    const r = await fetchLiveQuotes(['600519'])
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ code: '600519', name: '贵州茅台', source: 'sina' })
    expect(r.missing).toEqual([])
    expect(curlFetchMock).toHaveBeenCalledTimes(1)
    expect(directMock).not.toHaveBeenCalled()
    const [url, opts] = curlFetchMock.mock.calls[0] as [string, { headers: string[] }]
    expect(String(url)).toContain('hq.sinajs.cn/list=sh600519')
    expect(opts.headers).toEqual(['Referer: https://finance.sina.com.cn'])
  })

  it('新浪抛错 → 腾讯命中 source=tencent (腾讯查询带 sh/sz 前缀)', async () => {
    curlFetchMock.mockImplementation(async (...args: unknown[]) => {
      const u = String(args[0])
      if (u.includes('hq.sinajs.cn')) throw new Error('sina 403')
      if (u.includes('qt.gtimg.cn')) return gbk(tencentBody([['sh600519', TX_MOUTAI]]))
      throw new Error('unexpected: ' + u)
    })
    const r = await fetchLiveQuotes(['600519'])
    expect(r.items[0]).toMatchObject({ code: '600519', source: 'tencent', price: 1490.0 })
    expect(r.missing).toEqual([])
    expect(curlFetchMock).toHaveBeenCalledTimes(2)
    expect(String(curlFetchMock.mock.calls[1][0])).toContain('q=sh600519')
  })

  it('新浪返回空 → 腾讯命中', async () => {
    curlFetchMock.mockImplementation(async (...args: unknown[]) => {
      const u = String(args[0])
      if (u.includes('hq.sinajs.cn')) return gbk('var hq_str_sh600519="";')
      return gbk(tencentBody([['sh600519', TX_MOUTAI]]))
    })
    const r = await fetchLiveQuotes(['600519'])
    expect(r.items[0].source).toBe('tencent')
  })

  it('价格<=0 视为未命中 → 继续下一源', async () => {
    curlFetchMock.mockImplementation(async (...args: unknown[]) => {
      const u = String(args[0])
      if (u.includes('hq.sinajs.cn')) return gbk(sinaBody([['sh600519', '贵州茅台,600519,1,0.00,...']]))
      return gbk(tencentBody([['sh600519', TX_MOUTAI]]))
    })
    const r = await fetchLiveQuotes(['600519'])
    expect(r.items[0].source).toBe('tencent')
  })

  it('新浪/腾讯都失败 → 东财兜底命中 (f2 分→元)', async () => {
    curlFetchMock.mockImplementation(async (...args: unknown[]) => {
      const u = String(args[0])
      if (u.includes('hq.sinajs.cn')) throw new Error('sina down')
      if (u.includes('qt.gtimg.cn')) throw new Error('tx down')
      throw new Error('unexpected: ' + u)
    })
    directMock.mockResolvedValueOnce({ data: { diff: [{ f2: 149000, f3: 1.2, f12: '600519', f14: '贵州茅台' }] } })
    const r = await fetchLiveQuotes(['600519'])
    expect(r.items[0]).toMatchObject({ source: 'eastmoney-push2', price: 1490.0 })
    expect(r.missing).toEqual([])
    expect(directMock).toHaveBeenCalledTimes(1)
    expect(String(directMock.mock.calls[0][0])).toContain('push2.eastmoney.com')
  })

  it('部分代码三源全未命中 → missing 包含它们, items 只含命中', async () => {
    curlFetchMock.mockImplementation(async (...args: unknown[]) => {
      const u = String(args[0])
      if (u.includes('hq.sinajs.cn')) return gbk(sinaBody([['sh600519', SINA_MOUTAI]]))
      if (u.includes('qt.gtimg.cn')) return gbk(tencentBody([['sh600519', TX_MOUTAI]]))
      throw new Error('unexpected: ' + u)
    })
    const r = await fetchLiveQuotes(['600519', 'QQQ'])
    expect(r.items.map(i => i.code)).toEqual(['600519'])
    expect(r.missing).toEqual(['QQQ'])
  })

  it('重复代码去重 (只请求一次)', async () => {
    curlFetchMock.mockImplementation(async () => gbk(sinaBody([['sh600519', SINA_MOUTAI]])))
    const r = await fetchLiveQuotes(['600519', '600519'])
    expect(r.items).toHaveLength(1)
    expect(r.missing).toEqual([])
    expect(String(curlFetchMock.mock.calls[0][0]).match(/600519/g)).toHaveLength(1)
  })
})

describe('markSourceHealth', () => {
  it('成功 → lastOkAt 更新且 failStreak 归零; 连续失败 → failStreak 递增', () => {
    markSourceHealth('unit-test-src', true)
    const h1 = getSourceHealth()['unit-test-src']
    expect(h1.failStreak).toBe(0)
    expect(h1.lastOkAt).toBeGreaterThan(0)

    markSourceHealth('unit-test-src', false)
    const midOkAt = getSourceHealth()['unit-test-src'].lastOkAt
    markSourceHealth('unit-test-src', false)
    const h2 = getSourceHealth()['unit-test-src']
    expect(h2.failStreak).toBe(2)
    expect(h2.lastFailAt).toBeGreaterThanOrEqual(midOkAt ?? 0)

    markSourceHealth('unit-test-src', true)
    const h3 = getSourceHealth()['unit-test-src']
    expect(h3.failStreak).toBe(0)
    expect(h3.lastOkAt as number).toBeGreaterThanOrEqual(h1.lastOkAt as number)
  })
})
