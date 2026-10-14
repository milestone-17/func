/**
 * 指数顶底通道 store: 多指数独立缓存 (meta['index-channel-<secid>']) + 选择记忆 + 用户自管理列表。
 * 模式与 weekMa store 一致: JSON round-trip 剥响应式再写 IndexedDB。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchMonthlyBars, fitChannel, PRESET_INDICES, type MonthlyBar, type Channel } from '@/lib/indexChannel'
import { metaRepo } from '@/repos/metaRepo'

export const CHANNEL_SELECTION_KEY = 'index-channel-selection'
export const CHANNEL_INDICES_KEY = 'index-channel-indices' // 用户自管理列表
const channelKey = (secid: string) => `index-channel-${secid}`

export interface IndexChannelData {
  bars: MonthlyBar[]
  channel: Channel | null
  fetchedAt: number
  error?: string
}

/** 用户列表缺省: 仅上证 (既有数据不受影响, 首次加载时迁移) */
const DEFAULT_INDICES = [PRESET_INDICES[0].secid]

export const useChannelStore = defineStore('channel', () => {
  const selection = ref(PRESET_INDICES[0].secid)
  const byIndex = ref<Record<string, IndexChannelData>>({})
  const loading = ref(false)
  /** 用户自管理的指数列表 (secid 数组), meta 持久化 */
  const myIndices = ref<string[]>([...DEFAULT_INDICES])
  const listLoaded = ref(false)

  function current(): IndexChannelData | undefined {
    return byIndex.value[selection.value]
  }

  async function persistData(secid: string) {
    const d = byIndex.value[secid]
    if (!d) return
    // JSON round-trip 剥 Vue 响应式代理 (IndexedDB 无法克隆 proxy)
    const snapshot = JSON.parse(JSON.stringify(d)) as IndexChannelData
    await metaRepo.put({ key: channelKey(secid), value: snapshot })
  }

  /** 读本地快照回填 (不发请求) */
  async function loadFromCache(secid: string): Promise<void> {
    if (byIndex.value[secid]) return
    const snap = await metaRepo.get(channelKey(secid))
    if (snap?.value?.bars && Array.isArray(snap.value.bars)) {
      byIndex.value = { ...byIndex.value, [secid]: snap.value as IndexChannelData }
    }
  }

  /** 恢复用户列表 (旧用户: 曾存过选择但无列表 → 迁移为 [选择]; 全新用户 → 默认仅上证) */
  async function loadIndices(): Promise<void> {
    const saved = await metaRepo.get(CHANNEL_INDICES_KEY)
    if (Array.isArray(saved?.value) && saved.value.every((s: unknown) => typeof s === 'string')) {
      myIndices.value = saved.value
    } else {
      // 迁移: 老用户只有选择记忆, 把它放进列表; 否则默认上证
      const sel = await metaRepo.get(CHANNEL_SELECTION_KEY)
      myIndices.value = typeof sel?.value === 'string' ? [sel.value] : [...DEFAULT_INDICES]
      await persistIndices().catch(() => {})
    }
    listLoaded.value = true
  }

  async function persistIndices(): Promise<void> {
    await metaRepo.put({ key: CHANNEL_INDICES_KEY, value: JSON.parse(JSON.stringify(myIndices.value)) })
  }

  /** 恢复上次选择的指数 (不在列表内则用列表第一个) */
  async function loadSelection(): Promise<void> {
    const saved = await metaRepo.get(CHANNEL_SELECTION_KEY)
    const secid = saved?.value
    if (typeof secid === 'string' && myIndices.value.includes(secid)) {
      selection.value = secid
    } else if (myIndices.value.length > 0) {
      selection.value = myIndices.value[0]
    }
  }

  /**
   * 拉取并拟合。无缓存时前台加载; 已有缓存时静默后台刷新, 失败保留旧数据只标 error。
   */
  async function refresh(secid: string, opts: { force?: boolean } = {}): Promise<void> {
    const hadCache = !!byIndex.value[secid]?.channel
    const foreground = !hadCache || opts.force // 无缓存或手动强刷 → 前台 loading
    if (foreground) loading.value = true
    try {
      const bars = await fetchMonthlyBars(secid)
      if (!bars || bars.length === 0) {
        // 失败: 有旧数据 → 保留 channel 只标 error; 无旧数据 → 纯失败态
        const prev = byIndex.value[secid]
        const failed: IndexChannelData = prev
          ? { ...prev, error: '拉取失败' }
          : { bars: [], channel: null, fetchedAt: Date.now(), error: '拉取失败' }
        byIndex.value = { ...byIndex.value, [secid]: failed }
        return
      }
      const channel = fitChannel(bars)
      byIndex.value = { ...byIndex.value, [secid]: { bars, channel, fetchedAt: Date.now() } }
      await persistData(secid)
    } finally {
      if (foreground) loading.value = false
    }
  }

  /** 选择指数: 记忆 + 确保数据 (缓存优先, 无缓存前台拉取; 有缓存后台刷新) */
  async function selectIndex(secid: string): Promise<void> {
    selection.value = secid
    try {
      await metaRepo.put({ key: CHANNEL_SELECTION_KEY, value: secid })
    } catch {
      // 选择记忆保存失败 (如跨用户 id 冲突) 不应阻断行情自动拉取
    }
    await loadFromCache(secid)
    const d = byIndex.value[secid]
    if (!d?.channel) {
      await refresh(secid, { force: true })
    } else {
      void refresh(secid) // 有缓存: 后台刷新覆盖
    }
  }

  /** 添加指数到用户列表 (去重) 并选中 */
  async function addIndex(secid: string): Promise<void> {
    if (!PRESET_INDICES.some(i => i.secid === secid)) return
    if (myIndices.value.includes(secid)) {
      await selectIndex(secid)
      return
    }
    myIndices.value = [...myIndices.value, secid]
    try {
      await persistIndices()
    } catch { /* 列表持久化失败不阻断使用 */ }
    await selectIndex(secid)
  }

  /** 从用户列表移除 (至少保留一个; 若删的是当前选中则切换到剩余第一个) */
  async function removeIndex(secid: string): Promise<void> {
    if (myIndices.value.length <= 1) return
    myIndices.value = myIndices.value.filter(s => s !== secid)
    try {
      await persistIndices()
    } catch { /* 忽略 */ }
    if (selection.value === secid && myIndices.value.length > 0) {
      await selectIndex(myIndices.value[0])
    }
  }

  /** 失败重试 (单指数, 前台) */
  async function retry(secid: string): Promise<void> {
    await refresh(secid, { force: true })
  }

  return { selection, byIndex, loading, myIndices, listLoaded, current, loadFromCache, loadIndices, loadSelection, selectIndex, refresh, retry, addIndex, removeIndex }
})
