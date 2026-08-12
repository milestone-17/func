import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { holdingRepo } from '@/repos/holdingRepo'
import { holdingTxnRepo } from '@/repos/holdingTxnRepo'
import { convertCurrency } from '@/lib/currency'
import { useSettingsStore } from '@/stores/settings'
import type { Holding, HoldingTxn, Currency, Market } from '@/types/portfolio'

export interface HoldingView {
  id: string
  symbol: string
  name: string
  market: Market
  currency: Currency
  type: string
  quantity: number
  avgCost: number
  currentPrice: number | null
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
        market: h.market, currency: h.currency, type: h.type,
        quantity, avgCost, currentPrice: price,
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

  async function updatePrice(id: string, priceFen: number) {
    const h = await holdingRepo.get(id)
    if (!h) return
    h.currentPrice = priceFen
    h.currentPriceAt = Date.now()
    await holdingRepo.put(h)
    await refresh()
  }

  async function addTxn(input: Omit<HoldingTxn, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
    await holdingTxnRepo.add(input)
    await refresh()
  }

  const totalMarketValueCNY = computed(() =>
    holdings.value.reduce((s, h) => s + (h.marketValueCNY || 0), 0)
  )
  const totalCost = computed(() => holdings.value.reduce((s, h) => s + h.totalCost, 0))
  const totalUnrealized = computed(() => holdings.value.reduce((s, h) => s + (h.unrealized || 0), 0))

  return { holdings, loaded, refresh, addHolding, updatePrice, addTxn, totalMarketValueCNY, totalCost, totalUnrealized }
})
