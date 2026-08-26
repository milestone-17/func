/**
 * 周线状态 store: 一键拉取全部持仓 20/30/60 周线位置, 结果持久化到 meta['week-ma-snapshot']。
 *
 * 拉取必须串行: pingzhongdata 通过 window.Data_netWorthTrend 全局变量传数,
 * 并发加载会互相覆盖 (见 design.md D4)。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchWeekMaRow, type WeekMaRow } from '@/lib/weekMa'
import { metaRepo } from '@/repos/metaRepo'

export const WEEK_MA_SNAPSHOT_KEY = 'week-ma-snapshot'

export const useWeekMaStore = defineStore('weekMa', () => {
  const rows = ref<Record<string, WeekMaRow>>({})
  const loading = ref(false)
  const progress = ref(0)
  const total = ref(0)
  const fetchedAt = ref<number | null>(null)

  const hasAnyData = computed(() => Object.keys(rows.value).length > 0)

  function rowOf(holdingId: string): WeekMaRow | undefined {
    return rows.value[holdingId]
  }

  async function persist() {
    // JSON round-trip 剥离 Vue 响应式代理: IndexedDB 结构化克隆无法序列化 proxy (fake-indexeddb 报 DataCloneError)
    const snapshot = JSON.parse(JSON.stringify({ fetchedAt: fetchedAt.value, rows: rows.value })) as {
      fetchedAt: number | null
      rows: Record<string, WeekMaRow>
    }
    await metaRepo.put({ key: WEEK_MA_SNAPSHOT_KEY, value: snapshot })
  }

  /**
   * 串行拉取全部持仓的周线状态。
   * 返回 { ok, fail }; 无持仓或已在拉取中返回 null (调用方据此提示)。
   */
  async function fetchAll(holdings: { id: string; symbol: string; name: string }[]): Promise<{ ok: number; fail: number } | null> {
    if (loading.value || holdings.length === 0) return null
    loading.value = true
    progress.value = 0
    total.value = holdings.length
    let ok = 0
    let fail = 0
    for (const h of holdings) {
      const row = await fetchWeekMaRow(h) // 串行: 禁止并发 (全局变量竞态)
      rows.value = { ...rows.value, [h.id]: row }
      if (row.error) fail++
      else ok++
      progress.value++
    }
    fetchedAt.value = Date.now()
    loading.value = false
    await persist()
    return { ok, fail }
  }

  /** 单只重拉 (失败重试); 成功后更新快照 */
  async function retryOne(holding: { id: string; symbol: string; name: string }): Promise<void> {
    if (loading.value) return
    const row = await fetchWeekMaRow(holding)
    rows.value = { ...rows.value, [holding.id]: row }
    if (fetchedAt.value == null) fetchedAt.value = row.fetchedAt
    await persist()
  }

  /** 进入页面时回显最近一次快照 */
  async function loadFromCache(): Promise<void> {
    const snap = await metaRepo.get(WEEK_MA_SNAPSHOT_KEY)
    if (snap?.value?.rows && typeof snap.value.rows === 'object') {
      rows.value = snap.value.rows
      fetchedAt.value = snap.value.fetchedAt ?? null
    }
  }

  return { rows, loading, progress, total, fetchedAt, hasAnyData, rowOf, fetchAll, retryOne, loadFromCache }
})
