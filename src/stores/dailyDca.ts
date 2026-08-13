import { defineStore } from 'pinia'
import { ref } from 'vue'
import { dailyDcaConfigRepo } from '@/repos/dailyDcaConfigRepo'
import { holdingRepo } from '@/repos/holdingRepo'
import { holdingTxnRepo } from '@/repos/holdingTxnRepo'
import { usePortfolioStore } from '@/stores/portfolio'
import { shouldExecuteToday, computeDailyBuy } from '@/lib/dailyDca'
import type { DailyDcaConfig } from '@/types/dca'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface DailyDcaPatch {
  enabled?: boolean
  holdingId?: string | null
  dailyAmountFen?: number
  lastExecutedDate?: string | null
}

export const useDailyDcaStore = defineStore('dailyDca', () => {
  const config = ref<DailyDcaConfig | null>(null)
  const loaded = ref(false)
  const lastMessage = ref<string>('')

  async function load() {
    config.value = (await dailyDcaConfigRepo.get()) ?? null
    loaded.value = true
  }

  async function save(patch: DailyDcaPatch) {
    const base = config.value ?? {
      enabled: false,
      holdingId: null as string | null,
      dailyAmountFen: 0,
      lastExecutedDate: null as string | null
    }
    config.value = await dailyDcaConfigRepo.save({
      enabled: patch.enabled ?? base.enabled,
      holdingId: patch.holdingId ?? base.holdingId,
      dailyAmountFen: patch.dailyAmountFen ?? base.dailyAmountFen,
      lastExecutedDate: patch.lastExecutedDate ?? base.lastExecutedDate
    })
  }

  /**
   * 打开应用时调用: 若当日尚未执行且配置有效, 自动买入一笔并更新持仓。
   * 幂等: 当日已执行则跳过。浏览器关闭期间不执行 (无后台服务)。
   */
  async function runIfPending(): Promise<{ executed: boolean; reason?: 'no-price' | 'invalid' | 'not-configured' | 'already' }> {
    if (!config.value) return { executed: false, reason: 'not-configured' }
    const today = todayISO()
    if (!shouldExecuteToday(config.value, today)) return { executed: false, reason: 'already' }
    const holding = config.value.holdingId ? await holdingRepo.get(config.value.holdingId) : undefined
    const r = computeDailyBuy(config.value, holding, today)
    if (!r.ok) {
      lastMessage.value = r.reason === 'no-price'
        ? '今日定投已跳过:目标持仓暂无现价,请先填入或刷新现价'
        : '今日定投已跳过:配置无效'
      return { executed: false, reason: r.reason }
    }
    await holdingTxnRepo.add(r.txn)
    const amountFen = config.value.dailyAmountFen
    config.value = await dailyDcaConfigRepo.save({
      enabled: config.value.enabled,
      holdingId: config.value.holdingId,
      dailyAmountFen: amountFen,
      lastExecutedDate: today
    })
    const portfolio = usePortfolioStore()
    await portfolio.refresh()
    lastMessage.value = `已执行今日定投 ¥${(amountFen / 100).toFixed(2)}`
    return { executed: true }
  }

  return { config, loaded, lastMessage, load, save, runIfPending }
})
