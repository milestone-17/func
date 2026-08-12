import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dcaConfigRepo } from '@/repos/dcaConfigRepo'
import { indexDataRepo } from '@/repos/indexDataRepo'
import { dcaExecutionRepo } from '@/repos/dcaExecutionRepo'
import { fetchStooqBars } from '@/lib/stooq'
import { computeMA250 } from '@/lib/ma'
import { computeDeviation } from '@/lib/deviation'
import { computeWeekSuggestion, type SuggestionResult } from '@/lib/dca'
import { lookupBucket } from '@/lib/table'
import type { DCAConfig, IndexData, BucketResult } from '@/types/dca'

const DEFAULT_SYMBOL = 'QQQ.US'

export const useDcaStore = defineStore('dca', () => {
  const config = ref<DCAConfig | null>(null)
  const series = ref<IndexData[]>([])
  const bucket = ref<BucketResult | null>(null)
  const suggestions = ref<Record<1 | 2 | 3 | 4, SuggestionResult | null>>({
    1: null, 2: null, 3: null, 4: null
  })
  const lastSyncAt = ref<string | null>(null)
  const syncError = ref<string | null>(null)

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
    series.value = await indexDataRepo.listBySymbol(DEFAULT_SYMBOL)
    await recompute()
  }

  async function saveConfig(cfg: Omit<DCAConfig, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
    config.value = await dcaConfigRepo.save(cfg)
    await recompute()
  }

  function todayMinusDays(days: number): string {
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString().slice(0, 10)
  }

  async function syncIndex(symbol: string = DEFAULT_SYMBOL): Promise<{ ok: boolean; error?: string }> {
    syncError.value = null
    try {
      // 取 400 天数据 (MA250 + buffer)
      const to = todayMinusDays(0)
      const from = todayMinusDays(400)
      const bars = await fetchStooqBars(symbol, from, to)
      if (bars.length < 250) {
        return { ok: false, error: '数据不足 250 天' }
      }
      for (const b of bars) {
        await indexDataRepo.put({
          symbol,
          date: b.date,
          close: b.close,
          ma250: null,
          source: 'stooq',
          fetchedAt: Date.now()
        })
      }
      series.value = await indexDataRepo.listBySymbol(symbol)
      lastSyncAt.value = new Date().toISOString()
      await recompute()
      return { ok: true }
    } catch (e: any) {
      syncError.value = e?.message || '同步失败'
      return { ok: false, error: syncError.value! }
    }
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
    config, series, ma250, lastClose, bucket, suggestions, lastSyncAt, syncError, deviationPct,
    load, saveConfig, syncIndex, manualSetIndex, recompute, recordExecution
  }
})
