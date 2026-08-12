<template>
  <AppShell>
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">永久投资组合</h2>

      <section class="bg-white rounded-lg p-4 space-y-2">
        <div class="text-sm text-gray-500">总市值 (来自持仓)</div>
        <div class="text-2xl font-semibold">¥{{ formatYuan(perm.analysis.total) }}</div>
        <div class="text-xs text-gray-500">阈值: ±{{ settings.settings?.permanentThreshold ?? 5 }}%</div>
      </section>

      <div class="grid grid-cols-2 gap-2">
        <div v-for="d in perm.analysis.deviations" :key="d.assetType" class="bg-white rounded-lg p-3">
          <div class="flex items-center justify-between">
            <div class="font-semibold">{{ typeLabel(d.assetType) }}</div>
            <div class="text-xs px-2 py-0.5 rounded"
                 :class="Math.abs(d.deviation) > (settings.settings?.permanentThreshold ?? 5) ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'">
              {{ d.deviation > 0 ? '+' : '' }}{{ d.deviation.toFixed(2) }}%
            </div>
          </div>
          <div class="text-sm">实际 {{ d.actualPercent.toFixed(1) }}% / 目标 {{ d.targetPercent }}%</div>
          <div class="mt-2 flex items-center gap-1">
            <input type="number" :value="d.targetPercent" @change="updateTarget(d.assetType, $event)"
              class="w-16 px-1 py-0.5 border rounded text-right text-sm" />
            <span class="text-xs text-gray-500">%</span>
          </div>
        </div>
      </div>

      <div v-if="perm.analysis.alerts.length > 0" class="bg-red-50 border border-red-200 rounded-lg p-3">
        <h3 class="font-semibold text-red-700">⚠ 偏离提醒</h3>
        <ul class="text-sm text-red-700 mt-1 list-disc list-inside">
          <li v-for="a in perm.analysis.alerts" :key="a.assetType">
            {{ typeLabel(a.assetType) }} 偏离 {{ a.deviation > 0 ? '+' : '' }}{{ a.deviation.toFixed(2) }}%, 建议再平衡
          </li>
        </ul>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import AppShell from '@/components/AppShell.vue'
import { usePermanentStore } from '@/stores/permanent'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import { formatYuan } from '@/lib/money'
import type { AssetType } from '@/types/permanent'

const perm = usePermanentStore()
const portfolio = usePortfolioStore()
const settings = useSettingsStore()

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  await perm.load()
  await portfolio.refresh()
})

function typeLabel(t: AssetType) {
  return { stock: '股票', bond: '债券', cash: '现金', gold: '黄金' }[t]
}

async function updateTarget(t: AssetType, e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v) && v >= 0 && v <= 100) {
    await perm.setTarget(t, v)
  }
}
</script>
