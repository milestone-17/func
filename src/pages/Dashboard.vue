<template>
  <AppShell>
    <div class="space-y-4">
      <section class="bg-white rounded-lg p-4">
        <h2 class="font-semibold mb-2">本月概览</h2>
        <div class="grid grid-cols-2 gap-3">
          <div class="p-3 bg-green-50 rounded">
            <div class="text-xs text-gray-500">收入</div>
            <div class="text-xl font-semibold text-green-600">¥{{ incomeStr }}</div>
          </div>
          <div class="p-3 bg-red-50 rounded">
            <div class="text-xs text-gray-500">支出</div>
            <div class="text-xl font-semibold text-red-600">¥{{ expenseStr }}</div>
          </div>
        </div>
      </section>

      <section class="bg-white rounded-lg p-4">
        <h2 class="font-semibold mb-2">持仓总览</h2>
        <div class="text-2xl font-semibold">¥{{ portfolioValueStr }}</div>
        <div class="text-xs" :class="unrealizedClass">
          浮盈 ¥{{ unrealizedStr }}
        </div>
      </section>

      <section class="bg-white rounded-lg p-4">
        <h2 class="font-semibold mb-2">智能定投 · 本周</h2>
        <div v-if="dca.config">
          <div class="text-sm">偏离 {{ dca.deviationPct?.toFixed(2) ?? '—' }}%</div>
          <div class="text-sm">档位: {{ dca.bucket?.label || '—' }}</div>
        </div>
        <div v-else class="text-sm text-gray-500">
          尚未配置 <RouterLink to="/dca" class="text-blue-600">前往设置</RouterLink>
        </div>
      </section>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import { useLedgerStore } from '@/stores/ledger'
import { usePortfolioStore } from '@/stores/portfolio'
import { useDcaStore } from '@/stores/dca'
import { useSettingsStore } from '@/stores/settings'
import { formatYuan } from '@/lib/money'

const ledger = useLedgerStore()
const portfolio = usePortfolioStore()
const dca = useDcaStore()
const settings = useSettingsStore()

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  await ledger.refreshCategories()
  await ledger.refresh()
  await portfolio.refresh()
  await dca.load()
})

const currentMonth = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})

const monthStat = computed(() => ledger.monthStats.get(currentMonth.value) || { income: 0, expense: 0 })
const incomeStr = computed(() => formatYuan(monthStat.value.income))
const expenseStr = computed(() => formatYuan(monthStat.value.expense))
const portfolioValueStr = computed(() => formatYuan(portfolio.totalMarketValueCNY))
const unrealizedStr = computed(() => formatYuan(portfolio.totalUnrealized))
const unrealizedClass = computed(() => portfolio.totalUnrealized >= 0 ? 'text-green-600' : 'text-red-600')
</script>
