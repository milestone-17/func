<template>
  <AppShell>
    <div class="space-y-4">
      <div>
        <h2 class="text-lg font-bold tracking-tight">永久投资组合</h2>
        <p class="text-xs text-ink3">Harry Browne · 25/25/25/25 全天候配置 · 实际占比自动来自持仓</p>
      </div>

      <!-- 总览 -->
      <section class="card card-pad bg-gradient-to-br from-amber-500 to-orange-600 text-white border-0">
        <div class="text-xs font-medium text-white/80">组合总市值</div>
        <div class="money mt-1 text-3xl font-bold tracking-tight">¥{{ formatYuan(perm.analysis.total) }}</div>
        <div class="mt-1 text-[11px] text-white/80">偏离阈值 ±{{ settings.settings?.permanentThreshold ?? 5 }}% · 超出则建议再平衡</div>
      </section>

      <!-- 四类资产 -->
      <section class="space-y-2.5">
        <div v-for="d in perm.analysis.deviations" :key="d.assetType" class="card card-pad fade-in">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="grid h-8 w-8 place-items-center rounded-xl text-base">{{ assetIcon(d.assetType) }}</span>
              <div>
                <div class="text-sm font-semibold">{{ typeLabel(d.assetType) }}</div>
                <div class="money text-[11px] text-ink3">¥{{ formatYuan(d.marketValue) }}</div>
              </div>
            </div>
            <Badge :tone="Math.abs(d.deviation) > (settings.settings?.permanentThreshold ?? 5) ? 'red' : 'green'">
              {{ d.deviation > 0 ? '+' : '' }}{{ d.deviation.toFixed(1) }}%
            </Badge>
          </div>

          <!-- 目标 vs 实际 双进度条 -->
          <div class="mt-3 space-y-2">
            <div>
              <div class="flex justify-between text-[10px] text-ink3 mb-1">
                <span>目标 {{ d.targetPercent }}%</span>
                <span>实际 {{ d.actualPercent.toFixed(1) }}%</span>
              </div>
              <div class="relative h-2 rounded-full bg-surface2 overflow-hidden">
                <div class="absolute inset-y-0 left-0 rounded-full"
                     :style="{ width: d.targetPercent + '%', backgroundColor: 'rgb(var(--ink3) / 0.4)' }" />
                <div class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                     :style="{ width: Math.min(100, d.actualPercent) + '%', backgroundColor: barColor(d) }" />
              </div>
            </div>
            <!-- 目标调整 -->
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-ink3">目标</span>
              <input type="range" min="0" max="100" step="5" :value="d.targetPercent"
                     @change="updateTarget(d.assetType, $event)" class="flex-1 accent-brand" />
              <input type="number" :value="d.targetPercent" @change="updateTarget(d.assetType, $event)"
                     class="input !w-14 !py-1 !px-1 !text-xs !text-center money" />
              <span class="text-[11px] text-ink3">%</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 再平衡建议 -->
      <section v-if="perm.analysis.alerts.length > 0" class="card card-pad border-warn/40 bg-warn/5">
        <div class="flex items-center gap-2 mb-2">
          <span class="grid h-7 w-7 place-items-center rounded-lg bg-warn/15 text-warn">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </span>
          <h3 class="text-sm font-semibold text-warn">偏离提醒 · 建议再平衡</h3>
        </div>
        <ul class="space-y-1.5">
          <li v-for="a in perm.analysis.alerts" :key="a.assetType" class="flex items-center justify-between rounded-lg bg-surface px-3 py-1.5 text-xs">
            <span class="text-ink2">{{ assetIcon(a.assetType) }} {{ typeLabel(a.assetType) }}</span>
            <span class="font-medium text-warn">{{ a.deviation > 0 ? '+' : '' }}{{ a.deviation.toFixed(1) }}%</span>
          </li>
        </ul>
      </section>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import AppShell from '@/components/AppShell.vue'
import Badge from '@/components/Badge.vue'
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
function assetIcon(t: AssetType) {
  return { stock: '📈', bond: '📄', cash: '💵', gold: '🥇' }[t]
}
function barColor(d: { deviation: number }) {
  return Math.abs(d.deviation) > (settings.settings?.permanentThreshold ?? 5) ? 'rgb(var(--warn))' : 'rgb(var(--brand))'
}

async function updateTarget(t: AssetType, e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v) && v >= 0 && v <= 100) await perm.setTarget(t, v)
}
</script>
