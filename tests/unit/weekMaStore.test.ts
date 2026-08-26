import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'

// 网络层 mock: store 测试只验证串行编排/持久化/重试语义
vi.mock('@/lib/fundQuote', () => ({
  fetchFundNavTrend: vi.fn(async () => []),
}))
vi.mock('@/lib/yahoo', () => ({
  fetchWeeklyBars: vi.fn(async () => null),
}))

import { useWeekMaStore, WEEK_MA_SNAPSHOT_KEY } from '@/stores/weekMa'
import { fetchWeekMaRow } from '@/lib/weekMa'
import { metaRepo } from '@/repos/metaRepo'
import { resetDbForTests } from '@/repos/db'
import type { WeekMaRow } from '@/lib/weekMa'

// fetchWeekMaRow 已在 weekMa.test.ts 覆盖, 这里 mock 掉以控制成败
vi.mock('@/lib/weekMa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/weekMa')>()
  return { ...actual, fetchWeekMaRow: vi.fn() }
})

function wipeDb() {
  resetDbForTests()
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('func-db')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

const HOLDINGS = [
  { id: 'a', symbol: '110022', name: '基金A' },
  { id: 'b', symbol: 'QQQ', name: '纳指ETF' },
  { id: 'c', symbol: '00700', name: '港股' },
]

function okRow(id: string, symbol: string): WeekMaRow {
  return {
    holdingId: id, symbol, name: 'x', lastValue: 1.5, weekCount: 60,
    statuses: [
      { period: 20, ma: 1.4, position: 'above' },
      { period: 30, ma: 1.45, position: 'above' },
      { period: 60, ma: 1.5, position: 'above' },
    ],
    fetchedAt: 1700000000000,
  }
}

beforeEach(async () => {
  await wipeDb()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('weekMa store', () => {
  it('fetchAll: 逐只写入 rows 并整体持久化快照, 可读回', async () => {
    const mocked = vi.mocked(fetchWeekMaRow)
    mocked.mockImplementation(async (h) => okRow(h.id, h.symbol))
    const st = useWeekMaStore()
    const r = await st.fetchAll(HOLDINGS)
    expect(r).toEqual({ ok: 3, fail: 0 })
    expect(st.progress).toBe(3)
    expect(st.total).toBe(3)
    expect(Object.keys(st.rows)).toHaveLength(3)
    expect(st.rowOf('a')!.statuses[0].position).toBe('above')

    // 快照落库可读回
    const snap = await metaRepo.get(WEEK_MA_SNAPSHOT_KEY)
    expect(snap?.value.rows.a.symbol).toBe('110022')
    expect(snap?.value.fetchedAt).toBeGreaterThan(0)

    // 全新 pinia + store 实例回显快照
    setActivePinia(createPinia())
    const st2 = useWeekMaStore()
    expect(st2.hasAnyData).toBe(false)
    await st2.loadFromCache()
    expect(st2.rowOf('b')!.weekCount).toBe(60)
  })

  it('fetchAll: 串行逐只调用 (无并发)', async () => {
    const order: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    vi.mocked(fetchWeekMaRow).mockImplementation(async (h) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      order.push(`start:${h.id}`)
      await new Promise(res => setTimeout(res, 5))
      order.push(`end:${h.id}`)
      inFlight--
      return okRow(h.id, h.symbol)
    })
    const st = useWeekMaStore()
    await st.fetchAll(HOLDINGS)
    expect(maxInFlight).toBe(1) // 任意时刻最多 1 只在拉取
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
  })

  it('fetchAll: 单只失败不影响其余行写入, fail 计数正确', async () => {
    vi.mocked(fetchWeekMaRow).mockImplementation(async (h) => {
      if (h.id === 'b') {
        return { ...okRow('b', 'QQQ'), lastValue: null, weekCount: 0, statuses: [], error: '拉取失败' }
      }
      return okRow(h.id, h.symbol)
    })
    const st = useWeekMaStore()
    const r = await st.fetchAll(HOLDINGS)
    expect(r).toEqual({ ok: 2, fail: 1 })
    expect(st.rowOf('a')!.error).toBeUndefined()
    expect(st.rowOf('b')!.error).toBe('拉取失败')
    expect(st.rowOf('c')!.error).toBeUndefined()
  })

  it('fetchAll: 无持仓返回 null; 拉取中重复调用返回 null', async () => {
    const st = useWeekMaStore()
    expect(await st.fetchAll([])).toBeNull()
    vi.mocked(fetchWeekMaRow).mockImplementation(async (h) => {
      await new Promise(res => setTimeout(res, 10))
      return okRow(h.id, h.symbol)
    })
    const first = st.fetchAll(HOLDINGS)
    expect(st.loading).toBe(true)
    expect(await st.fetchAll(HOLDINGS)).toBeNull() // 并发防重
    expect(await first).toEqual({ ok: 3, fail: 0 })
  })

  it('retryOne: 成功后覆盖失败行并清 error', async () => {
    vi.mocked(fetchWeekMaRow).mockResolvedValue({ ...okRow('b', 'QQQ'), error: '拉取失败' })
    const st = useWeekMaStore()
    await st.fetchAll(HOLDINGS)
    expect(st.rowOf('b')!.error).toBe('拉取失败')

    vi.mocked(fetchWeekMaRow).mockResolvedValue(okRow('b', 'QQQ'))
    await st.retryOne({ id: 'b', symbol: 'QQQ', name: '纳指ETF' })
    expect(st.rowOf('b')!.error).toBeUndefined()
    // 快照同步更新
    const snap = await metaRepo.get(WEEK_MA_SNAPSHOT_KEY)
    expect(snap?.value.rows.b.error).toBeUndefined()
  })

  it('loadFromCache: 无快照时保持空态', async () => {
    const st = useWeekMaStore()
    await st.loadFromCache()
    expect(st.hasAnyData).toBe(false)
    expect(st.fetchedAt).toBeNull()
  })
})
