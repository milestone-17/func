import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dcaConfigRepo } from '@/repos/dcaConfigRepo'
import { indexDataRepo } from '@/repos/indexDataRepo'
import { dcaExecutionRepo } from '@/repos/dcaExecutionRepo'
import { loadBundledQuotes, fetchLiveQuotes, barsToIndexData } from '@/lib/yahoo'
import { computeMA250 } from '@/lib/ma'
import { computeDeviation } from '@/lib/deviation'
import { computeWeekSuggestion, type SuggestionResult } from '@/lib/dca'
import { lookupBucket } from '@/lib/table'
import type { DCAConfig, IndexData, BucketResult } from '@/types/dca'

const DEFAULT_SYMBOL = '^NDX'

export const useDcaStore = defineStore('dca', () => {
  const config = ref<DCAConfig | null>(null)
  const series = ref<IndexData[]>([])
  const bucket = ref<BucketResult | null>(null)
  const suggestions = ref<Record<1 | 2 | 3 | 4, SuggestionResult | null>>({
    1: null, 2: null, 3: null, 4: null
  })
  const lastSyncAt = ref<string | null>(null)
  const syncError = ref<string | null>(null)
  const dataSource = ref<'yahoo' | 'cache' | null>(null)  // cache = 预置数据

  const ma250 = computed<number | null>(() => {
    const closes = series.value.map(d => d.close)
    return computeMA250(closes)
  })
  const lastClose = computed<number | null>(() => {
    const last = series.value[series.value.length - 1]
    return last ? last.close : null
  })
  const deviationPct = computed(() => {
    if (lastClose.value == null || ma250.value == null || ma250.value === 0) return null
    return computeDeviation(lastClose.value, ma250.value)
  })

  async function load() {
    config.value = (await dcaConfigRepo.get()) || null
    let s = await indexDataRepo.listBySymbol(DEFAULT_SYMBOL)
    // 首次进入: 用打包进站点的预置行情初始化 (同源, 必成功)
    if (s.length < 250) {
      const bundled = await loadBundledQuotes()
      if (bundled && bundled.bars.length >= 250) {
        for (const r of barsToIndexData(bundled.bars, 'cache')) await indexDataRepo.put(r)
        s = await indexDataRepo.listBySymbol(DEFAULT_SYMBOL)
        lastSyncAt.value = new Date(bundled.fetchedAt).toISOString()
        dataSource.value = 'cache'
      }
    }
    series.value = s
    await recompute()
  }

  async function saveConfig(cfg: Omit<DCAConfig, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
    config.value = await dcaConfigRepo.save(cfg)
    await recompute()
  }

  async function syncIndex(_symbol: string = DEFAULT_SYMBOL): Promise<{ ok: boolean; error?: string }> {
    syncError.value = null
    // 1. 尝试实时拉取 (Yahoo via 代理链; 浏览器里常失败)
    let bars = await fetchLiveQuotes()
    let source: 'yahoo' | 'cache' = 'yahoo'
    // 2. 失败则回落到打包进站点的预置行情 (同源, 必成功)
    if (!bars || bars.length < 250) {
      const bundled = await loadBundledQuotes()
      if (bundled && bundled.bars.length >= 250) {
        bars = bundled.bars
        source = 'cache'
      }
    }
    if (!bars || bars.length < 250) {
      syncError.value = '无法获取行情,请手动录入'
      return { ok: false, error: syncError.value }
    }
    for (const r of barsToIndexData(bars, source)) await indexDataRepo.put(r)
    series.value = await indexDataRepo.listBySymbol(DEFAULT_SYMBOL)
    lastSyncAt.value = new Date().toISOString()
    dataSource.value = source
    await recompute()
    return { ok: true }
  }

  /** 手动录入: 把整个序列作为一条 "今天" 的 manual 行写入, MA250 直接算好 */
  function manualSetIndex(closes: number[], lastCloseInput: number) {
    const data: IndexData = {
      symbol: DEFAULT_SYMBOL,
      date: new Date().toISOString().slice(0, 10),
      close: lastCloseInput,
      ma250: computeMA250(closes),
      source: 'manual',
      fetchedAt: Date.now()
    }
    indexDataRepo.put(data).then(async () => {
      series.value = await indexDataRepo.listBySymbol(DEFAULT_SYMBOL)
      recompute()
    })
  }

  async function recompute() {
    if (!config.value || lastClose.value == null || ma250.value == null) {
      suggestions.value = { 1: null, 2: null, 3: null, 4: null }
      bucket.value = null
      return
    }
    const dev = computeDeviation(lastClose.value, ma250.value)
    bucket.value = lookupBucket(dev)
    for (const w of [1, 2, 3, 4] as const) {
      suggestions.value[w] = computeWeekSuggestion(config.value, { close: lastClose.value, ma250: ma250.value }, w)
    }
  }

  async function recordExecution(weekIndex: 1 | 2 | 3 | 4, executedAmount: number, actualPrice?: number) {
    if (!config.value || lastClose.value == null) return
    const today = new Date().toISOString().slice(0, 10)
    const month = today.slice(0, 7)
    const sug = suggestions.value[weekIndex]
    const plannedAmount = config.value.weeklySplits[weekIndex - 1]
    await dcaExecutionRepo.add({
      configId: config.value.id,
      month,
      weekIndex,
      date: today,
      symbol: DEFAULT_SYMBOL,
      plannedAmount,
      suggestedAmount: sug?.suggestedAmount ?? plannedAmount,
      executedAmount,
      deviationPct: deviationPct.value ?? 0,
      priceAtBuy: actualPrice ?? lastClose.value,
      sharesBought: actualPrice != null && actualPrice > 0 ? executedAmount / (actualPrice * 100) : 0
    })
  }

  return {
    config, series, ma250, lastClose, bucket, suggestions, lastSyncAt, syncError, deviationPct, dataSource,
    load, saveConfig, syncIndex, manualSetIndex, recompute, recordExecution
  }
})
