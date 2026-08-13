import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { holdingRepo } from '@/repos/holdingRepo'
import { holdingTxnRepo } from '@/repos/holdingTxnRepo'
import { convertCurrency } from '@/lib/currency'
import { fetchHoldingPrice } from '@/lib/yahoo'
import { yuanToFen } from '@/lib/money'
import { inferCategory } from '@/lib/category'
import { useSettingsStore } from '@/stores/settings'
import type { Holding, HoldingTxn, Currency, Market, HoldingCategory } from '@/types/portfolio'

export interface HoldingView {
  id: string
  symbol: string
  name: string
  market: Market
  currency: Currency
  type: string
  category: HoldingCategory
  quantity: number
  avgCost: number
  currentPrice: number | null
  currentPriceIsEstimate: boolean
  marketValueOriginal: number | null
  marketValueCNY: number | null
  totalCost: number
  unrealized: number | null
  unrealizedPct: number | null
}

export const usePortfolioStore = defineStore('portfolio', () => {
  const holdings = ref<HoldingView[]>([])
  const loaded = ref(false)

  async function refresh() {
    const settings = useSettingsStore()
    if (!settings.loaded) await settings.load()
    const list = await holdingRepo.list()
    const out: HoldingView[] = []
    for (const h of list) {
      const { quantity, avgCost } = await holdingTxnRepo.computeAvgCost(h.id)
      const totalCost = Math.round(quantity * avgCost)
      const rate = settings.settings?.usdCnyRate || 7.2
      const price = h.currentPrice ?? null
      let marketValueOriginal: number | null = null
      let marketValueCNY: number | null = null
      let unrealized: number | null = null
      let unrealizedPct: number | null = null
      if (price != null) {
        marketValueOriginal = Math.round(price * quantity)
        marketValueCNY = h.currency === 'CNY' ? marketValueOriginal : convertCurrency(marketValueOriginal, 'USD', 'CNY', rate)
        unrealized = marketValueOriginal - totalCost
        unrealizedPct = totalCost > 0 ? (unrealized / totalCost) * 100 : Infinity
      }
      out.push({
        id: h.id, symbol: h.symbol, name: h.name,
        market: h.market, currency: h.currency, type: h.type, category: h.category ?? 'other',
        quantity, avgCost, currentPrice: price, currentPriceIsEstimate: h.currentPriceIsEstimate ?? false,
        marketValueOriginal, marketValueCNY, totalCost, unrealized, unrealizedPct
      })
    }
    holdings.value = out
    loaded.value = true
  }

  async function addHolding(input: Omit<Holding, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Holding> {
    const h = await holdingRepo.add(input)
    await refresh()
    return h
  }

  async function updatePrice(id: string, priceFen: number, isEstimate = false) {
    const h = await holdingRepo.get(id)
    if (!h) return
    h.currentPrice = priceFen
    h.currentPriceAt = Date.now()
    h.currentPriceIsEstimate = isEstimate
    await holdingRepo.put(h)
    await refresh()
  }

  /**
   * 拉取全部持仓最新价。逐只按代码形态路由拉取, 成功更新现价与估值标记;
   * 失败 (含接口不可用) 保留原值, 仅累计到 failed 列表, 绝不清空。
   */
  async function refreshAllPrices(): Promise<{ updated: number; failed: { id: string; name: string }[] }> {
    const list = await holdingRepo.list()
    const failed: { id: string; name: string }[] = []
    let updated = 0
    for (const h of list) {
      try {
        const r = await fetchHoldingPrice(h.market, h.symbol)
        if (r && r.price > 0) {
          h.currentPrice = yuanToFen(r.price)
          h.currentPriceAt = Date.now()
          h.currentPriceIsEstimate = r.isEstimate
          await holdingRepo.put(h)
          updated++
        } else {
          failed.push({ id: h.id, name: h.name })
        }
      } catch {
        failed.push({ id: h.id, name: h.name })
      }
    }
    await refresh()
    return { updated, failed }
  }

  async function addTxn(input: Omit<HoldingTxn, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
    await holdingTxnRepo.add(input)
    await refresh()
  }

  /**
   * 按名称/代码批量重新自动分类。
   * scope='unclassified' 仅重算「其他」(默认, 不覆盖用户手动设置); 'all' 重算全部。
   * 返回被改变的持仓数。
   */
  async function reclassifyAll(scope: 'unclassified' | 'all' = 'unclassified'): Promise<number> {
    const list = await holdingRepo.list()
    let n = 0
    for (const h of list) {
      if (scope === 'unclassified' && h.category && h.category !== 'other') continue
      const next = inferCategory(h.name, h.symbol)
      if (next !== (h.category ?? 'other')) {
        h.category = next
        await holdingRepo.put(h)
        n++
      }
    }
    await refresh()
    return n
  }

  const totalMarketValueCNY = computed(() =>
    holdings.value.reduce((s, h) => s + (h.marketValueCNY || 0), 0)
  )
  const totalCost = computed(() => holdings.value.reduce((s, h) => s + h.totalCost, 0))
  const totalUnrealized = computed(() => holdings.value.reduce((s, h) => s + (h.unrealized || 0), 0))

  /** 按 category 聚合: category -> { 小计市值(CNY), 数量 } */
  const byCategory = computed(() => {
    const map: Record<string, { marketValueCNY: number; count: number }> = {}
    for (const h of holdings.value) {
      const cat = h.category
      if (!map[cat]) map[cat] = { marketValueCNY: 0, count: 0 }
      map[cat].marketValueCNY += h.marketValueCNY || 0
      map[cat].count += 1
    }
    return map
  })

  return { holdings, loaded, refresh, addHolding, updatePrice, refreshAllPrices, addTxn, reclassifyAll, totalMarketValueCNY, totalCost, totalUnrealized, byCategory }
})
