/**
 * 估值分位端到端集成测试 (mock fetch)
 * 不真打网络, 但走完 fetchOne 完整路径, 断言 percentile 落在合理范围.
 * mock 的响应形状与真实东财 datacenter-web 报表对齐:
 *   - 指数 RPT_VALUEMARKET:        result.data[].TRADE_DATE / PE_TTM_AVG, 每页 500 条, 翻页
 *   - 行业 RPT_VALUEINDUSTRY_DET:  result.data[].TRADE_DATE / PE_TTM / PB_MRQ, 一次拿全
 *
 * 跑法: `npm test -- tests/integration/valuation.fetch.test.ts`
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOne, BUILTIN_SYMBOLS } from '@/lib/valuation'
import type { ValuationSymbol } from '@/types/valuation'

/**
 * 构造"按请求页码响应"的 fetch mock —— 与真实 datacenter 分页行为一致:
 * 每个 response 返回 { result: { data, count } }, data 是该页的估值行 (降序).
 * opts.field 决定用 PE_TTM_AVG (指数) 还是 PE_TTM (行业).
 */
function makePagingFetchMock(opts: {
  center: number
  count: number
  perPage: number
  field: 'PE_TTM_AVG' | 'PE_TTM'
  pbField?: 'PB_MRQ' | null
}) {
  return vi.fn(async (url: string) => {
    const u = new URL(String(url))
    const page = Number(u.searchParams.get('pageNumber') ?? '1')
    const start = (page - 1) * opts.perPage
    const remaining = Math.max(0, opts.count - start)
    const n = Math.min(opts.perPage, remaining)
    const data: Record<string, unknown>[] = []
    const today = new Date('2026-08-13')
    for (let i = 0; i < n; i++) {
      const idx = start + i
      const d = new Date(today)
      d.setDate(d.getDate() - idx)
      // 确定性噪声 (sin/cos), 避免 flaky; 最新行 (idx=0) 恰好 = center, 便于断言
      const noise = idx === 0 ? 0 : Math.sin(idx * 0.7) * 0.15 + Math.cos(idx * 1.3) * 0.05
      const row: Record<string, unknown> = {
        TRADE_DATE: d.toISOString().slice(0, 10) + ' 00:00:00',  // 真实东财带时间后缀
        [opts.field]: +(opts.center * (1 + noise)).toFixed(2)
      }
      if (opts.pbField) row[opts.pbField] = 3.2
      data.push(row)
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: { data, count: opts.count } })
    } as Response
  })
}

/**
 * 显式历史序列 mock: 第 1 条 (最新) 用 newestPe, 其余用给定历史. 用于构造"当前极值"场景.
 */
function makeExplicitHistoryMock(newestPe: number, historyPe: number[], field: 'PE_TTM' | 'PE_TTM_AVG' = 'PE_TTM') {
  const today = new Date('2026-08-13')
  const rows: Record<string, unknown>[] = [
    { TRADE_DATE: '2026-08-13 00:00:00', [field]: newestPe, PB_MRQ: 1.0 }
  ]
  for (let i = 0; i < historyPe.length; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - (i + 1))
    rows.push({ TRADE_DATE: d.toISOString().slice(0, 10) + ' 00:00:00', [field]: historyPe[i], PB_MRQ: 1.0 })
  }
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ result: { data: rows, count: rows.length } })
  }) as Response)
}

/** 行业 symbol: BUILTIN_SYMBOLS[6] = 银行Ⅱ (1 次请求拿全) */
const INDUSTRY: ValuationSymbol = BUILTIN_SYMBOLS[6]
/** 指数 symbol: BUILTIN_SYMBOLS[0] = 上证指数 (分页) */
const INDEX: ValuationSymbol = BUILTIN_SYMBOLS[0]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchOne - 行业 (RPT_VALUEINDUSTRY_DET, 1 请求)', () => {
  it('正常路径: 当前 PE 在历史中位附近 → 分位 50 左右, PB 从 PB_MRQ 解析', async () => {
    const center = 12
    vi.stubGlobal('fetch', makePagingFetchMock({ center, count: 2334, perPage: 2400, field: 'PE_TTM', pbField: 'PB_MRQ' }))

    const row = await fetchOne(INDUSTRY)
    expect(row.failReason).toBeUndefined()
    expect(row.peTtm).toBeCloseTo(center, 1)
    expect(row.pb).toBeCloseTo(3.2, 1)
    expect(row.percentile).not.toBeNull()
    expect(row.percentile!).toBeGreaterThan(40)
    expect(row.percentile!).toBeLessThan(60)
  })

  it('只请求 1 次, pageSize=2400 一次拿全', async () => {
    const fetchMock = makePagingFetchMock({ center: 12, count: 2334, perPage: 2400, field: 'PE_TTM', pbField: 'PB_MRQ' })
    vi.stubGlobal('fetch', fetchMock)
    await fetchOne(INDUSTRY)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toMatch(/reportName=RPT_VALUEINDUSTRY_DET/)
    expect(url).toMatch(/pageSize=2400/)
  })

  it('PE 高于历史最高 → 分位 100, 落入"极度高估"档', async () => {
    // 历史全部 ≤ 10, 当前 20
    vi.stubGlobal('fetch', makeExplicitHistoryMock(20, [10, 9, 8, 9, 10, 7, 6, 8]))
    const row = await fetchOne(INDUSTRY)
    expect(row.failReason).toBeUndefined()
    expect(row.percentile).toBe(100)
    expect(row.bucket).toBe('high')
    expect(row.bucketLabel).toBe('极度高估')
    expect(row.bucketTone).toBe('red')
  })

  it('PE 低于历史最低 → 落"极度低估"档 (当前值在自身历史内, 分位最小 1/N, 不为 0)', async () => {
    // 历史全部 ≥ 20, 当前 5 (含自身在内最小)
    vi.stubGlobal('fetch', makeExplicitHistoryMock(5, [20, 21, 22, 25, 30, 28]))
    const row = await fetchOne(INDUSTRY)
    expect(row.failReason).toBeUndefined()
    expect(row.percentile).not.toBeNull()
    expect(row.percentile!).toBeLessThan(20)
    expect(row.bucket).toBe('low')
    expect(row.bucketLabel).toBe('极度低估')
  })
})

describe('fetchOne - 指数 (RPT_VALUEMARKET, 翻页)', () => {
  it('正常路径: 1 页 (count=500) → 分位 50 左右, PB 为 null (报表无 PB)', async () => {
    const center = 13
    vi.stubGlobal('fetch', makePagingFetchMock({ center, count: 500, perPage: 500, field: 'PE_TTM_AVG' }))

    const row = await fetchOne(INDEX)
    expect(row.failReason).toBeUndefined()
    expect(row.peTtm).toBeCloseTo(center, 1)
    expect(row.pb).toBeNull()
    expect(row.percentile).not.toBeNull()
    expect(row.percentile!).toBeGreaterThan(40)
    expect(row.percentile!).toBeLessThan(60)
  })

  it('count>500 时翻页: 2334 条 → 5 次请求, 历史合并后分位仍正确', async () => {
    const center = 13
    const fetchMock = makePagingFetchMock({ center, count: 2334, perPage: 500, field: 'PE_TTM_AVG' })
    vi.stubGlobal('fetch', fetchMock)

    const row = await fetchOne(INDEX)
    expect(fetchMock).toHaveBeenCalledTimes(5)  // 500×4 + 334
    expect(row.failReason).toBeUndefined()
    expect(row.percentile).not.toBeNull()
    expect(row.percentile!).toBeGreaterThan(40)
    expect(row.percentile!).toBeLessThan(60)
  })

  it('翻页时第 2 页起 pageNumber 递增且带正确 filter', async () => {
    const fetchMock = makePagingFetchMock({ center: 13, count: 1200, perPage: 500, field: 'PE_TTM_AVG' })
    vi.stubGlobal('fetch', fetchMock)

    await fetchOne(INDEX)
    const p2 = new URL(fetchMock.mock.calls[1][0] as string)
    expect(p2.searchParams.get('pageNumber')).toBe('2')
    expect(p2.searchParams.get('reportName')).toBe('RPT_VALUEMARKET')
    expect(p2.searchParams.get('pageSize')).toBe('500')
    expect(p2.searchParams.get('filter')).toBe('(TRADE_MARKET_CODE="000001")')
  })

  it('最新一行 PE 为 0 (数据异常) → 解析器丢弃该行, 回退到最近有效值', async () => {
    vi.stubGlobal('fetch', makeExplicitHistoryMock(0, [13.2, 13.5], 'PE_TTM_AVG'))
    const row = await fetchOne(INDEX)
    expect(row.failReason).toBeUndefined()
    expect(row.peTtm).toBeCloseTo(13.2, 1)
    expect(row.percentile).not.toBeNull()
  })
})

describe('fetchOne - 失败路径 + URL 回归', () => {
  it('HTTP 500 → failReason = "history-fail: HTTP 500"', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response)
    )
    const row = await fetchOne(INDUSTRY)
    expect(row.failReason).toBe('history-fail: HTTP 500')
    expect(row.percentile).toBeNull()
  })

  it('返回空 result.data → failReason = "history-empty"', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: { data: [], count: 0 } }) } as Response)
    )
    const row = await fetchOne(INDUSTRY)
    expect(row.failReason).toBe('history-empty')
  })

  it('fetch 抛异常 (网络挂) → failReason 以 "network-fail" 开头', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')))
    const row = await fetchOne(INDUSTRY)
    expect(row.failReason).toMatch(/^network-fail/)
  })

  it('行业 URL: filter 单次编码, 不能出现 %25 (双重编码回归)', async () => {
    // BUILTIN_SYMBOLS[6] = 银行Ⅱ, BOARD_CODE=016029
    const fetchMock = makePagingFetchMock({ center: 7, count: 500, perPage: 2400, field: 'PE_TTM', pbField: 'PB_MRQ' })
    vi.stubGlobal('fetch', fetchMock)

    await fetchOne(INDUSTRY)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toMatch(/%25/)
    expect(url).toMatch(/filter=%28BOARD_CODE%3D%22016029%22%29/)
    expect(url).toMatch(/sortColumns=TRADE_DATE/)
    expect(url).toMatch(/sortTypes=-1/)
  })

  it('指数 URL: filter 用 TRADE_MARKET_CODE 短码', async () => {
    const fetchMock = makePagingFetchMock({ center: 13, count: 500, perPage: 500, field: 'PE_TTM_AVG' })
    vi.stubGlobal('fetch', fetchMock)

    await fetchOne(INDEX)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toMatch(/reportName=RPT_VALUEMARKET/)
    expect(url).toMatch(/filter=%28TRADE_MARKET_CODE%3D%22000001%22%29/)
    expect(url).not.toMatch(/%25/)
  })
})
