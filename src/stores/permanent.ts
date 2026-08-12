import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { permanentTargetRepo } from '@/repos/permanentTargetRepo'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import { computePermanentDeviation } from '@/lib/permanent'
import type { PermTarget, AssetType, HoldingForPerm } from '@/types/permanent'

export const usePermanentStore = defineStore('permanent', () => {
  const targets = ref<PermTarget[]>([])
  const loaded = ref(false)

  async function load() {
    await permanentTargetRepo.seedDefault()
    targets.value = await permanentTargetRepo.list()
    loaded.value = true
  }

  async function setTarget(assetType: AssetType, percent: number) {
    await permanentTargetRepo.upsert({ assetType, targetPercent: percent })
    targets.value = await permanentTargetRepo.list()
  }

  const analysis = computed(() => {
    const portfolio = usePortfolioStore()
    const settings = useSettingsStore()
    const threshold = settings.settings?.permanentThreshold ?? 5
    const holdings: HoldingForPerm[] = portfolio.holdings
      .filter(h => h.marketValueCNY != null && (h.type === 'stock' || h.type === 'bond' || h.type === 'cash' || h.type === 'gold'))
      .map(h => ({ type: h.type as AssetType, marketValueCNY: h.marketValueCNY! }))
    return computePermanentDeviation(holdings, targets.value, threshold)
  })

  return { targets, loaded, load, setTarget, analysis }
})
