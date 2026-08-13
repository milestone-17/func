import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dcaConfigRepo } from '@/repos/dcaConfigRepo'
import { indexDataRepo } from '@/repos/indexDataRepo'
import { dcaExecutionRepo } from '@/repos/dcaExecutionRepo'
import { holdingRepo } from '@/repos/holdingRepo'
import { holdingTxnRepo } from '@/repos/holdingTxnRepo'
import { loadBundledQuotes, fetchLiveQuotes, barsToIndexData } from '@/lib/yahoo'
import { computeMA, computeMA250 } from '@/lib/ma'
import { computeDeviation } from '@/lib/deviation'
import { computeWeekSuggestion, type SuggestionResult } from '@/lib/dca'
import { lookupBucket } from '@/lib/table'
import { weekOfMonth, monthOf } from '@/lib/dcaWeek'
import { usePortfolioStore } from '@/stores/portfolio'
import type { DCAConfig, IndexData, BucketResult } from '@/types/dca'

/** 测试注入点: 通过 setTodayForTests 覆盖 todayISO 返回值 (避免 fake timers 破坏 IndexedDB) */
let _todayOverride: string | null = null
export function setDcaTodayForTests(d: string | null) { _todayOverride = d }
function todayISO(): string {
  if (_todayOverride) return _todayOverride
  return new Date().toISOString().slice(0, 10)
}

/** 定投支持的标的 (均按均线偏离策略) */
export const DCA_SYMBOLS = ['^NDX', '^GSPC'] as const
export const DCA_LABELS: Record<string, string> = {
  '^NDX': '纳斯达克100',
  '^GSPC': '标普500'
}

interface SymbolState {
  config: DCAConfig | null
  series: IndexData[]
  bucket: BucketResult | null
  suggestions: Record<1 | 2 | 3 | 4, SuggestionResult | null>
  lastSyncAt: string | null
  syncError: string | null
  dataSource: 'yahoo' | 'cache' | null
}

function emptyState(): SymbolState {
  return {
    config: null, series: [], bucket: null,
    suggestions: { 1: null, 2: null, 3: null, 4: null },
    lastSyncAt: null, syncError: null, dataSource: null
  }
}

export const useDcaStore = defineStore('dca', () => {
  const activeSymbol = ref<string>('^NDX')
  const states = ref<Record<string, SymbolState>>({})
  for (const s of DCA_SYMBOLS) states.value[s] = emptyState()

  // ---- 单 symbol 派生值 ----
  function maOf(symbol: string, period: number): number | null {
    const st = states.value[symbol]
    if (!st) return null
    return computeMA(st.series.map(d => d.close), period)
  }
  function lastCloseOf(symbol: string): number | null {
    const st = states.value[symbol]
    const last = st?.series[st.series.length - 1]
    return last ? last.close : null
  }
  function deviationOf(symbol: string): number | null {
    const close = lastCloseOf(symbol)
    const ma250 = maOf(symbol, 250)
    if (close == null || ma250 == null || ma250 === 0) return null
    return computeDeviation(close, ma250)
  }

  // ---- 顶层 computed (代理 activeSymbol, 保持向后兼容) ----
  const config = computed(() => states.value[activeSymbol.value]?.config ?? null)
  const series = computed(() => states.value[activeSymbol.value]?.series ?? [])
  const ma120 = computed(() => maOf(activeSymbol.value, 120))
  const ma180 = computed(() => maOf(activeSymbol.value, 180))
  const ma250 = computed(() => maOf(activeSymbol.value, 250))
  const lastClose = computed(() => lastCloseOf(activeSymbol.value))
  const deviationPct = computed(() => deviationOf(activeSymbol.value))
  const bucket = computed(() => states.value[activeSymbol.value]?.bucket ?? null)
  const suggestions = computed(() => states.value[activeSymbol.value]?.suggestions ?? { 1: null, 2: null, 3: null, 4: null })
  const lastSyncAt = computed(() => states.value[activeSymbol.value]?.lastSyncAt ?? null)
  const syncError = computed(() => states.value[activeSymbol.value]?.syncError ?? null)
  const dataSource = computed(() => states.value[activeSymbol.value]?.dataSource ?? null)

  function setActive(symbol: string) { activeSymbol.value = symbol }

  async function loadSymbol(symbol: string) {
    const st = states.value[symbol] ?? emptyState()
    st.config = (await dcaConfigRepo.getBySymbol(symbol)) || null
    let s = await indexDataRepo.listBySymbol(symbol)
    // 首次进入: 用打包进站点的预置行情初始化 (同源, 必成功)
    if (s.length < 250) {
      const bundled = await loadBundledQuotes(symbol)
      if (bundled && bundled.bars.length >= 250) {
        for (const r of barsToIndexData(bundled.bars, 'cache', symbol)) await indexDataRepo.put(r)
        s = await indexDataRepo.listBySymbol(symbol)
        st.lastSyncAt = new Date(bundled.fetchedAt).toISOString()
        st.dataSource = 'cache'
      }
    }
    st.series = s
    states.value = { ...states.value, [symbol]: { ...st } }
    await recomputeSymbol(symbol)
  }

  async function load() {
    for (const s of DCA_SYMBOLS) await loadSymbol(s)
  }

  async function saveConfig(cfg: Omit<DCAConfig, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
    const symbol = activeSymbol.value
    const saved = await dcaConfigRepo.saveBySymbol(symbol, cfg)
    states.value = { ...states.value, [symbol]: { ...states.value[symbol], config: saved } }
    await recomputeSymbol(symbol)
  }

  async function syncIndex(): Promise<{ ok: boolean; error?: string }> {
    const symbol = activeSymbol.value
    const st = states.value[symbol]
    if (!st) return { ok: false, error: '未知标的' }
    let next = { ...st, syncError: null as string | null }
    // 1. 尝试实时拉取 (Yahoo via 代理链; 浏览器里常失败)
    let bars = await fetchLiveQuotes(symbol)
    let source: 'yahoo' | 'cache' = 'yahoo'
    // 2. 失败回落打包预置行情 (同源, 必成功)
    if (!bars || bars.length < 250) {
      const bundled = await loadBundledQuotes(symbol)
      if (bundled && bundled.bars.length >= 250) {
        bars = bundled.bars
        source = 'cache'
      }
    }
    if (!bars || bars.length < 250) {
      next.syncError = '无法获取行情,请手动录入'
      states.value = { ...states.value, [symbol]: next }
      return { ok: false, error: next.syncError }
    }
    for (const r of barsToIndexData(bars, source, symbol)) await indexDataRepo.put(r)
    next.series = await indexDataRepo.listBySymbol(symbol)
    next.lastSyncAt = new Date().toISOString()
    next.dataSource = source
    states.value = { ...states.value, [symbol]: next }
    await recomputeSymbol(symbol)
    return { ok: true }
  }

  /** 手动录入: 把整个序列作为一条 "今天" 的 manual 行写入, MA250 直接算好 */
  function manualSetIndex(closes: number[], lastCloseInput: number) {
    const symbol = activeSymbol.value
    const data: IndexData = {
      symbol,
      date: todayISO(),
      close: lastCloseInput,
      ma250: computeMA250(closes),
      source: 'manual',
      fetchedAt: Date.now()
    }
    indexDataRepo.put(data).then(async () => {
      const st = states.value[symbol]
      states.value = {
        ...states.value,
        [symbol]: { ...st, series: await indexDataRepo.listBySymbol(symbol) }
      }
      recomputeSymbol(symbol)
    })
  }

  async function recomputeSymbol(symbol: string) {
    const st = states.value[symbol]
    if (!st) return
    const close = lastCloseOf(symbol)
    const ma250v = maOf(symbol, 250)
    if (!st.config || close == null || ma250v == null) {
      states.value = {
        ...states.value,
        [symbol]: { ...st, suggestions: { 1: null, 2: null, 3: null, 4: null }, bucket: null }
      }
      return
    }
    const dev = computeDeviation(close, ma250v)
    const newBucket = lookupBucket(dev)
    const newSug: Record<1 | 2 | 3 | 4, SuggestionResult | null> = { 1: null, 2: null, 3: null, 4: null }
    for (const w of [1, 2, 3, 4] as const) {
      newSug[w] = computeWeekSuggestion(st.config, { close, ma250: ma250v }, w)
    }
    states.value = { ...states.value, [symbol]: { ...st, bucket: newBucket, suggestions: newSug } }
  }

  async function recordExecution(weekIndex: 1 | 2 | 3 | 4, executedAmount: number, actualPrice?: number) {
    const symbol = activeSymbol.value
    const st = states.value[symbol]
    if (!st?.config) return
    const close = lastCloseOf(symbol)
    if (close == null) return
    const today = todayISO()
    const month = today.slice(0, 7)
    const sug = st.suggestions[weekIndex]
    const plannedAmount = st.config.weeklySplits[weekIndex - 1]
    const finalPrice = actualPrice ?? close
    await dcaExecutionRepo.add({
      configId: st.config.id,
      month,
      weekIndex,
      date: today,
      symbol,
      plannedAmount,
      suggestedAmount: sug?.suggestedAmount ?? plannedAmount,
      executedAmount,
      deviationPct: deviationOf(symbol) ?? 0,
      priceAtBuy: finalPrice,
      sharesBought: executedAmount / (finalPrice * 100)
    })
    // 目标基金存在 → 生成 buy 交易 (金额按 executedAmount, 数量按 finalPrice)
    const targetId = st.config.targetHoldingId
    if (targetId) {
      const target = await holdingRepo.get(targetId)
      if (target && executedAmount > 0 && finalPrice > 0) {
        // 优先用持仓自带的现价, 没有则用指数收盘价兜底
        const priceFen = target.currentPrice && target.currentPrice > 0
          ? target.currentPrice
          : Math.round(finalPrice * 100)
        if (priceFen > 0) {
          const qty = executedAmount / 100 / (priceFen / 100) // 元/元 = 份
          await holdingTxnRepo.add({
            holdingId: targetId,
            side: 'buy',
            date: today,
            price: priceFen,
            quantity: qty,
            fee: 0,
            note: `定投自动执行·W${weekIndex} ${st.config.symbol}`
          })
          const portfolio = usePortfolioStore()
          await portfolio.refresh()
        }
      }
    }
  }

  /**
   * 遍历全部 DCA 标的: 当 (month, weekIndex) 槽位无执行记录时按建议金额自动记账并落 buy 交易。
   * 幂等: 同槽位重复调用不会重复落账 (依赖 dcaExecutionRepo.findBySlot)。
   * 浏览器关闭/跨多日不会回溯, 仅在 onMounted 触发 (无后台服务)。
   * 返回成功/跳过的执行明细供上层 toast。
   */
  async function runAutoExecutions(today?: string): Promise<{ executed: { symbol: string; weekIndex: 1 | 2 | 3 | 4; amount: number }[]; skipped: { symbol: string; weekIndex: 1 | 2 | 3 | 4; reason: string }[] }> {
    const todayStr = today ?? todayISO()
    const month = monthOf(todayStr)
    const wk = weekOfMonth(todayStr)
    const executed: { symbol: string; weekIndex: 1 | 2 | 3 | 4; amount: number }[] = []
    const skipped: { symbol: string; weekIndex: 1 | 2 | 3 | 4; reason: string }[] = []
    for (const symbol of DCA_SYMBOLS) {
      const st = states.value[symbol]
      const cfg = st?.config
      if (!cfg) { skipped.push({ symbol, weekIndex: wk, reason: 'no-config' }); continue }
      if (!cfg.targetHoldingId) { skipped.push({ symbol, weekIndex: wk, reason: 'no-target' }); continue }
      const existing = await dcaExecutionRepo.findBySlot(cfg.id, month, wk)
      if (existing) { skipped.push({ symbol, weekIndex: wk, reason: 'already-executed' }); continue }
      const sug = st.suggestions[wk]
      if (!sug || !sug.suggestedAmount || sug.suggestedAmount <= 0) {
        skipped.push({ symbol, weekIndex: wk, reason: 'no-suggestion' }); continue
      }
      // 切到 active symbol 让 recordExecution 用正确的 config
      activeSymbol.value = symbol
      await recordExecution(wk, sug.suggestedAmount)
      executed.push({ symbol, weekIndex: wk, amount: sug.suggestedAmount })
    }
    return { executed, skipped }
  }

  return {
    activeSymbol, states,
    config, series, ma120, ma180, ma250, lastClose, deviationPct, bucket, suggestions, lastSyncAt, syncError, dataSource,
    setActive, load, saveConfig, syncIndex, manualSetIndex, recomputeSymbol, recordExecution, runAutoExecutions
  }
})
