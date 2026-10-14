import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'

// 拉取层 mock: store 测试只验证缓存/选择/失败语义
vi.mock('@/lib/fundQuote', () => ({ jsonpGet: vi.fn(async () => null) }))
vi.mock('@/lib/yahoo', () => ({
  PROXIES: [],
  fetchWithTimeout: vi.fn(async () => ({ ok: false }) as unknown as Response),
}))
vi.mock('@/lib/indexChannel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/indexChannel')>()
  return { ...actual, fetchMonthlyBars: vi.fn(async () => null) }
})

import { useChannelStore, CHANNEL_SELECTION_KEY, CHANNEL_INDICES_KEY } from '@/stores/channel'
import { fetchMonthlyBars, fitChannel, type MonthlyBar } from '@/lib/indexChannel'
import { metaRepo } from '@/repos/metaRepo'
import { resetDbForTests } from '@/repos/db'

function wipeDb() {
  resetDbForTests()
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('func-db')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

/** 简版合成月 K: 底线 100+5t / 顶线 +400+6t, 每 9/12 月触线, 偏移 ±100 (同 indexChannel.test 模式) */
function miniBars(n = 120): MonthlyBar[] {
  const bars: MonthlyBar[] = []
  const bottom = (t: number) => 100 + 5 * t
  const top = (t: number) => bottom(t) + 400 + 6 * t
  for (let t = 0; t < n; t++) {
    const low = t % 9 === 4 ? bottom(t) : bottom(t) + 100
    const high = t % 12 === 6 ? top(t) : top(t) - 100
    bars.push({
      date: `${1990 + Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-28`,
      open: (low + high) / 2, close: (low + high) / 2, high, low
    })
  }
  return bars
}

beforeEach(async () => {
  await wipeDb()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('channel store', () => {
  it('selectIndex: 无缓存前台拉取 → 拟合 → 快照落库可读回', async () => {
    vi.mocked(fetchMonthlyBars).mockResolvedValue(miniBars())
    const st = useChannelStore()
    await st.selectIndex('1.000001')
    expect(st.selection).toBe('1.000001')
    const d = st.current()!
    expect(d.error).toBeUndefined()
    expect(d.channel).not.toBeNull()
    expect(d.channel!.bottom.slope).toBeGreaterThan(0)
    // 落库
    const snap = await metaRepo.get('index-channel-1.000001')
    expect(snap?.value.bars).toHaveLength(120)
    // 全新 pinia 回显
    setActivePinia(createPinia())
    const st2 = useChannelStore()
    await st2.loadFromCache('1.000001')
    expect(st2.current === undefined || st2.byIndex['1.000001'].bars.length === 120).toBe(true)
    expect(st2.byIndex['1.000001'].channel).not.toBeNull()
  })

  it('默认列表: 全新用户仅上证', async () => {
    const st = useChannelStore()
    expect(st.selection).toBe('1.000001') // 默认
    await st.loadIndices()
    expect(st.myIndices).toEqual(['1.000001'])
    await st.loadSelection()
    expect(st.selection).toBe('1.000001')
  })

  it('列表管理: 添加/移除持久化, 删到只剩 1 个被拒, 删当前选中自动切换', async () => {
    vi.mocked(fetchMonthlyBars).mockResolvedValue(miniBars())
    const st = useChannelStore()
    await st.loadIndices()

    await st.addIndex('0.399006')
    expect(st.myIndices).toEqual(['1.000001', '0.399006'])
    expect(st.selection).toBe('0.399006') // 添加后选中
    expect(await metaRepo.get(CHANNEL_INDICES_KEY)).toMatchObject({ value: ['1.000001', '0.399006'] })

    // 重复添加 → 仅切换选中, 不重复入列
    await st.addIndex('0.399006')
    expect(st.myIndices).toEqual(['1.000001', '0.399006'])

    // 删除当前选中 → 自动切到剩余第一个
    await st.removeIndex('0.399006')
    expect(st.myIndices).toEqual(['1.000001'])
    expect(st.selection).toBe('1.000001')

    // 删到只剩 1 个 → 拒绝
    await st.removeIndex('1.000001')
    expect(st.myIndices).toEqual(['1.000001'])

    // 非法 secid → 忽略
    await st.addIndex('9.999999')
    expect(st.myIndices).toEqual(['1.000001'])
  })

  it('选择持久化: 列表内恢复上次选择; 不在列表/非法 → 回落列表第一个', async () => {
    vi.mocked(fetchMonthlyBars).mockResolvedValue(miniBars())
    const st = useChannelStore()
    await st.loadIndices()
    await st.addIndex('0.399006') // 列表 [上证, 创业板] 且选中创业板
    expect(await metaRepo.get(CHANNEL_SELECTION_KEY)).toMatchObject({ value: '0.399006' })

    setActivePinia(createPinia())
    const st2 = useChannelStore()
    await st2.loadIndices()
    await st2.loadSelection()
    expect(st2.selection).toBe('0.399006') // 列表内 → 恢复

    // 记忆了列表外/非法值 → 回落列表第一个
    await metaRepo.put({ key: CHANNEL_SELECTION_KEY, value: '9.999999' })
    setActivePinia(createPinia())
    const st3 = useChannelStore()
    await st3.loadIndices()
    await st3.loadSelection()
    expect(st3.selection).toBe('1.000001')
  })

  it('旧用户迁移: 只有选择记忆无列表 → 列表=[选择]', async () => {
    // 老用户遗留: 曾选中创业板 (列表记录不存在)
    await metaRepo.put({ key: CHANNEL_SELECTION_KEY, value: '0.399006' })
    const st = useChannelStore()
    await st.loadIndices()
    expect(st.myIndices).toEqual(['0.399006'])
  })

  it('拉取失败: 无缓存 → 纯失败态; retry 成功后清 error', async () => {
    vi.mocked(fetchMonthlyBars).mockResolvedValue(null)
    const st = useChannelStore()
    await st.selectIndex('1.000300')
    expect(st.current()!.error).toBe('拉取失败')
    expect(st.current()!.channel).toBeNull()

    vi.mocked(fetchMonthlyBars).mockResolvedValue(miniBars())
    await st.retry('1.000300')
    expect(st.current()!.error).toBeUndefined()
    expect(st.current()!.channel).not.toBeNull()
  })

  it('后台刷新失败: 保留旧 channel, 只标 error; 成功后 error 清除', async () => {
    vi.mocked(fetchMonthlyBars).mockResolvedValue(miniBars())
    const st = useChannelStore()
    await st.selectIndex('1.000001')
    const oldFetchedAt = st.current()!.fetchedAt
    const oldBars = st.current()!.bars.length

    vi.mocked(fetchMonthlyBars).mockResolvedValue(null)
    await st.refresh('1.000001')
    expect(st.current()!.channel).not.toBeNull() // 旧通道保留
    expect(st.current()!.error).toBe('拉取失败')
    expect(st.current()!.bars).toHaveLength(oldBars)
    expect(st.current()!.fetchedAt).toBe(oldFetchedAt)

    vi.mocked(fetchMonthlyBars).mockResolvedValue(miniBars(121))
    await st.refresh('1.000001')
    expect(st.current()!.error).toBeUndefined()
    expect(st.current()!.bars).toHaveLength(121)
  })

  it('两指数缓存互不串', async () => {
    const barsBySecid: Record<string, MonthlyBar[]> = {
      '1.000001': miniBars(120),
      '0.399006': miniBars(150),
    }
    vi.mocked(fetchMonthlyBars).mockImplementation(async (secid: string) => barsBySecid[secid] ?? null)
    const st = useChannelStore()
    await st.selectIndex('1.000001')
    await st.selectIndex('0.399006')
    expect(st.byIndex['1.000001'].bars).toHaveLength(120)
    expect(st.byIndex['0.399006'].bars).toHaveLength(150)
    // 各自快照独立
    expect((await metaRepo.get('index-channel-1.000001'))?.value.bars).toHaveLength(120)
    expect((await metaRepo.get('index-channel-0.399006'))?.value.bars).toHaveLength(150)
  })

  it('fitChannel 对 miniBars 不误报 lowConfidence', () => {
    // 侧带: 确保 miniBars 作为测试夹具本身有效 (120 月, 13 低枢轴/10 高枢轴)
    const ch = fitChannel(miniBars())
    expect(ch.lowConfidence).toBe(false)
  })
})
