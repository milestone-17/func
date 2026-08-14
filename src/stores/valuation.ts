/**
 * 估值分位 Pinia store
 * - 协调 fetchOne 串行拉取 + 进度
 * - 拉取成功后写当日快照到 IndexedDB
 * - 7 天内快照自动加载; 拉取失败时降级到任意历史快照 (stale)
 * - getter displayedRows: 搜索 + 排序叠加
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { BUILTIN_SYMBOLS, fetchOne, matchesSearch } from '@/lib/valuation'
import { valuationRepo } from '@/repos/valuationRepo'
import type { ValuationRow, ValuationSnapshot, SortMode, ValuationSymbol } from '@/types/valuation'

export const useValuationStore = defineStore('valuation', () => {
  // ---- state ----
  const rows = ref<ValuationRow[]>([])
  const progress = ref(0)            // 0-100
  const loading = ref(false)
  const error = ref<string | null>(null)
  const sortMode = ref<SortMode>('priority')
  const search = ref('')
  const lastFetchedAt = ref<number | null>(null)
  const staleDate = ref<string | null>(null)  // 当 rows 来自陈旧快照时填, UI 标"陈旧"

  // ---- getters ----

  /** 搜索 + 排序 后的展示行 */
  const displayedRows = computed<ValuationRow[]>(() => {
    const filtered = rows.value.filter(r => matchesSearch({ name: r.name, code: r.code }, search.value))
    const dir = sortMode.value === 'priority' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const ap = a.percentile
      const bp = b.percentile
      // null (无分位) 永远排到最底
      if (ap == null && bp == null) return 0
      if (ap == null) return 1
      if (bp == null) return -1
      return (ap - bp) * dir
    })
  })

  const summary = computed<{ lowest: ValuationRow | null; highest: ValuationRow | null; count: number; failCount: number }>(() => {
    const valid = rows.value.filter(r => r.percentile != null)
    let lowest: ValuationRow | null = null
    let highest: ValuationRow | null = null
    for (const r of valid) {
      if (!lowest || (r.percentile != null && r.percentile < lowest.percentile!)) lowest = r
      if (!highest || (r.percentile != null && r.percentile > highest.percentile!)) highest = r
    }
    return {
      lowest,
      highest,
      count: rows.value.length,
      failCount: rows.value.filter(r => r.failReason).length
    }
  })

  // ---- actions ----

  /**
   * 并行拉取全部内置标的 (指数内部翻页, 并行保证整体快)
   * 返回 { ok, fail }; 进度通过 progress ref 实时更新
   */
  async function fetchAll(): Promise<{ ok: number; fail: number }> {
    if (loading.value) return { ok: 0, fail: 0 }
    loading.value = true
    error.value = null
    progress.value = 0
    staleDate.value = null
    const startMs = Date.now()
    const total = BUILTIN_SYMBOLS.length
    const freshRows: ValuationRow[] = []
    let ok = 0
    let fail = 0

    // 先建占位行 (UI 能立刻看到骨架)
    for (const s of BUILTIN_SYMBOLS) {
      freshRows.push({
        code: s.symbol,
        name: s.name,
        kind: s.kind,
        peTtm: null, pb: null, percentile: null,
        bucket: null, bucketLabel: null, bucketAdvice: null, bucketTone: null,
        fetchedAt: Date.now()
      })
    }
    rows.value = freshRows

    // 并行拉取 (指数内部翻 5 页, 串行 40 请求太慢; fetchOne 失败不抛, 写 failReason)
    let done = 0
    const results = await Promise.all(
      BUILTIN_SYMBOLS.map(async (sym) => {
        const row = await fetchOne(sym)
        done++
        progress.value = Math.round((done / total) * 100)
        return row
      })
    )
    rows.value = results
    for (const row of results) {
      if (row.failReason) fail++
      else ok++
    }

    // 写当日快照
    try {
      const snapshot: ValuationSnapshot = {
        id: new Date().toISOString().slice(0, 10),
        takenAt: Date.now(),
        source: 'eastmoney',
        rows: [...rows.value]
      }
      await valuationRepo.put(snapshot)
      lastFetchedAt.value = snapshot.takenAt
    } catch (e) {
      // 写库失败不阻塞, 但记 error
      error.value = e instanceof Error ? e.message : 'snapshot-save-fail'
    }

    // 全部失败 → 尝试加载任意陈旧快照
    if (ok === 0 && fail > 0) {
      const stale = await valuationRepo.getLatest()
      if (stale) {
        rows.value = stale.rows
        staleDate.value = stale.id
      }
    }

    loading.value = false
    void startMs
    return { ok, fail }
  }

  /**
   * 进入页面时尝试加载 7 天内快照
   * - 有 → 填 rows + lastFetchedAt, 不设 staleDate
   * - 无 → 不自动加载 (用户主动拉取)
   */
  async function loadFromCache(): Promise<boolean> {
    const fresh = await valuationRepo.getWithinDays(7)
    if (fresh) {
      rows.value = fresh.rows
      lastFetchedAt.value = fresh.takenAt
      staleDate.value = null
      return true
    }
    return false
  }

  /**
   * 拉取失败时的降级入口: 任意时间的最近快照
   */
  async function staleFallback(): Promise<boolean> {
    const stale = await valuationRepo.getLatest()
    if (stale) {
      rows.value = stale.rows
      staleDate.value = stale.id
      return true
    }
    return false
  }

  /**
   * 重跑单个标的
   */
  async function retryOne(code: string): Promise<void> {
    const sym: ValuationSymbol | undefined = BUILTIN_SYMBOLS.find(s => s.symbol === code)
    if (!sym) return
    const row = await fetchOne(sym)
    const idx = rows.value.findIndex(r => r.code === code)
    if (idx >= 0) rows.value.splice(idx, 1, row)
  }

  function setSortMode(m: SortMode): void { sortMode.value = m }
  function setSearch(q: string): void { search.value = q }

  return {
    rows, progress, loading, error, sortMode, search, lastFetchedAt, staleDate,
    displayedRows, summary,
    fetchAll, loadFromCache, staleFallback, retryOne,
    setSortMode, setSearch
  }
})
