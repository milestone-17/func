/**
 * 估值 store 集成测试: fetchAll 枚举 + 渐进填充 + 枚举失败兜底
 * - mock 掉 valuationRepo (IndexedDB) 与全局 fetch
 * - 6 指数 (RPT_VALUEMARKET 1 页) + 行业历史 (RPT_VALUEINDUSTRY_DET)
 *
 * 跑法: `npm test -- tests/integration/valuation.store.test.ts`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useValuationStore } from '@/stores/valuation'

// 隔离 IndexedDB 依赖: fetchAll 写快照/读兜底都走 mock
vi.mock('@/repos/valuationRepo', () => ({
  valuationRepo: {
    put: vi.fn(async (s: unknown) => s),
    getLatest: vi.fn(async () => undefined),
    getWithinDays: vi.fn(async () => undefined),
    listRecent: vi.fn(async () => [])
  }
}))

function resp(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

/** 行业历史响应 (60 个交易日, 当前=center 无噪声) */
function historyResponse(center: number, count = 60) {
  const today = new Date('2026-08-13')
  const data: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const noise = i === 0 ? 0 : Math.sin(i * 0.7) * 0.1
    data.push({ TRADE_DATE: d.toISOString().slice(0, 10) + ' 00:00:00', PE_TTM: +(center * (1 + noise)).toFixed(2), PB_MRQ: 1 })
  }
  return { result: { data, count } }
}

/** 指数历史响应 (PE_TTM_AVG, 60 个交易日) */
function indexResponse(center: number, count = 60) {
  const today = new Date('2026-08-13')
  const data: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const noise = i === 0 ? 0 : Math.sin(i * 0.7) * 0.1
    data.push({ TRADE_DATE: d.toISOString().slice(0, 10) + ' 00:00:00', PE_TTM_AVG: +(center * (1 + noise)).toFixed(2) })
  }
  return { result: { data, count } }
}

/** 轮询等待条件满足 */
async function until(cond: () => boolean, timeoutMs = 1500): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('until: 条件超时')
    await new Promise(r => setTimeout(r, 5))
  }
}

/**
 * 按 URL 路由的 fetch mock:
 *   pageSize=1            → 发现最新交易日
 *   BOARD_CODE%2CBOARD_NAME → 枚举快照 (BOARD_CODE,BOARD_NAME 列)
 *   BOARD_CODE%3D%22      → 行业历史
 *   TRADE_MARKET_CODE%3D  → 指数历史
 */
function makeFetchRouter(opts: {
  industries: Array<{ code: string; name: string }>
  industryCenter?: number
  indexCenter?: number
}) {
  const { industries, industryCenter = 12, indexCenter = 13 } = opts
  return vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('pageSize=1')) {
      return resp({ result: { data: [{ TRADE_DATE: '2026-08-13 00:00:00' }] } })
    }
    if (u.includes('BOARD_CODE%2CBOARD_NAME')) {
      return resp({ result: { data: industries.map((b, i) => ({ BOARD_CODE: b.code, BOARD_NAME: b.name, PE_TTM: 10 + i, PB_MRQ: 1 })) } })
    }
    if (u.includes('BOARD_CODE%3D')) {
      return resp(historyResponse(industryCenter))
    }
    if (u.includes('TRADE_MARKET_CODE%3D')) {
      return resp(indexResponse(indexCenter))
    }
    throw new Error('unexpected url: ' + u)
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useValuationStore.fetchAll - 枚举 + 渐进填充', () => {
  it('枚举 2 行业 → 6 指数 + 2 行业共 8 行, 全部分位非空', async () => {
    vi.stubGlobal('fetch', makeFetchRouter({
      industries: [
        { code: '016001', name: '航空机场' },
        { code: '016002', name: '铁路公路' }
      ]
    }))
    const store = useValuationStore()
    const { ok, fail } = await store.fetchAll()
    expect(ok).toBe(8)
    expect(fail).toBe(0)
    expect(store.rows.length).toBe(8)
    expect(store.rows.slice(0, 6).every(r => r.kind === 'index')).toBe(true)
    expect(store.rows[6].name).toBe('航空机场')
    expect(store.rows[7].name).toBe('铁路公路')
    expect(store.rows.every(r => r.percentile != null && r.peTtm != null)).toBe(true)
    expect(store.progress).toBe(100)
  })

  it('渐进填充: 慢标未完成前, 先就位的行已就地填好分位', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('pageSize=1')) return resp({ result: { data: [{ TRADE_DATE: '2026-08-13 00:00:00' }] } })
      if (u.includes('BOARD_CODE%2CBOARD_NAME')) {
        return resp({ result: { data: [{ BOARD_CODE: '016001', BOARD_NAME: '行业A', PE_TTM: 12, PB_MRQ: 1 }] } })
      }
      if (u.includes('BOARD_CODE%3D')) {
        await gate  // 唯一行业历史 → 挂起到最后
        return resp(historyResponse(12))
      }
      return resp(indexResponse(13))
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useValuationStore()
    const p = store.fetchAll()

    // 指数已就位, 但行业仍为空占位
    await until(() => store.rows[0]?.percentile != null)
    expect(store.rows[0].kind).toBe('index')
    expect(store.rows[6].percentile).toBeNull()

    release()
    await p
    expect(store.rows.every(r => r.percentile != null)).toBe(true)
  })
})

describe('useValuationStore.fetchAll - 枚举失败兜底', () => {
  it('枚举失败但有上次内存列表 → 兜底继续拉行业, 不抛错', async () => {
    let enumFail = false
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('pageSize=1')) return resp({ result: { data: [{ TRADE_DATE: '2026-08-13 00:00:00' }] } })
      if (u.includes('BOARD_CODE%2CBOARD_NAME')) {
        if (enumFail) throw new Error('boom')
        return resp({ result: { data: [{ BOARD_CODE: '016001', BOARD_NAME: '行业A', PE_TTM: 12, PB_MRQ: 1 }] } })
      }
      if (u.includes('BOARD_CODE%3D')) return resp(historyResponse(12))
      return resp(indexResponse(13))
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useValuationStore()
    await store.fetchAll()
    expect(store.rows.length).toBe(7)

    enumFail = true
    const { ok, fail } = await store.fetchAll()
    expect(fail).toBe(0)
    expect(ok).toBe(7)  // 兜底到内存行业列表, 行业行仍被拉取
    expect(store.rows.length).toBe(7)
    expect(store.rows[6].name).toBe('行业A')
  })

  it('枚举失败且无任何行业缓存 → 仅拉 6 指数, 不抛错', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('pageSize=1')) return resp({ result: { data: [{ TRADE_DATE: '2026-08-13 00:00:00' }] } })
      if (u.includes('BOARD_CODE%2CBOARD_NAME')) throw new Error('boom')
      if (u.includes('TRADE_MARKET_CODE%3D')) return resp(indexResponse(13))
      throw new Error('不应请求行业历史: ' + u)
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useValuationStore()
    const { ok, fail } = await store.fetchAll()
    expect(ok).toBe(6)
    expect(fail).toBe(0)
    expect(store.rows.length).toBe(6)
    expect(store.rows.every(r => r.kind === 'index')).toBe(true)
  })
})
