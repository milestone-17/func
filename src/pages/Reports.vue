<template>
  <AppShell>
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold tracking-tight">报表统计</h2>
          <p class="text-xs text-ink3">收支结构与趋势分析</p>
        </div>
      </div>

      <!-- 范围筛选 -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex rounded-xl bg-surface2 p-0.5 shrink-0">
          <button v-for="opt in rangeOptions" :key="opt.value" @click="rangeType = opt.value"
            :class="['rounded-lg px-3 py-1.5 text-xs font-medium transition', rangeType === opt.value ? 'bg-surface text-ink shadow-sm' : 'text-ink3']">
            {{ opt.label }}
          </button>
        </div>
        <select v-if="rangeType === 'month'" v-model="selectedMonth" class="input !w-auto !py-1.5 !text-sm shrink-0">
          <option v-for="m in availableMonths" :key="m" :value="m">{{ m }}</option>
        </select>
        <select v-if="rangeType === 'year'" v-model="selectedYear" class="input !w-auto !py-1.5 !text-sm shrink-0">
          <option v-for="y in availableYears" :key="y" :value="y">{{ y }} 年</option>
        </select>
        <div class="flex rounded-xl bg-surface2 p-0.5 shrink-0 ml-auto">
          <button v-for="opt in typeOptions" :key="opt.value" @click="statType = opt.value"
            :class="['rounded-lg px-3 py-1.5 text-xs font-medium transition', statType === opt.value ? 'bg-surface text-ink shadow-sm' : 'text-ink3']">
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- 汇总卡 -->
      <div class="card card-pad grid grid-cols-3 gap-2 md:flex md:items-center md:justify-around md:divide-x md:divide-line">
        <div class="text-center">
          <div class="text-[11px] text-ink3">收入</div>
          <div class="money text-base font-bold text-pos">+¥{{ formatYuan(summary.income) }}</div>
        </div>
        <div class="text-center pl-4">
          <div class="text-[11px] text-ink3">支出</div>
          <div class="money text-base font-bold text-neg">-¥{{ formatYuan(summary.expense) }}</div>
        </div>
        <div class="text-center pl-4">
          <div class="text-[11px] text-ink3">结余</div>
          <div class="money text-base font-bold" :class="summary.income - summary.expense >= 0 ? 'text-pos' : 'text-neg'">
            {{ summary.income - summary.expense >= 0 ? '+' : '-' }}¥{{ formatYuan(Math.abs(summary.income - summary.expense)) }}
          </div>
        </div>
      </div>

      <!-- 支出/收入 分类占比 -->
      <section v-if="catLabels.length" class="card card-pad">
        <span class="section-title mb-3">{{ statType === 'expense' ? '支出' : '收入' }}分类占比</span>
        <PieChart :labels="catLabels" :values="catValues" :colors="catColors" :height="180" doughnut show-legend />
      </section>
      <div v-else class="card card-pad text-center py-8 text-sm text-ink3">所选范围暂无{{ statType === 'expense' ? '支出' : '收入' }}记录</div>

      <!-- 分类排行 -->
      <section v-if="catRanking.length" class="card card-pad">
        <span class="section-title mb-3">{{ statType === 'expense' ? '支出' : '收入' }}分类排行</span>
        <div class="space-y-2.5">
          <div v-for="r in catRanking" :key="r.id" class="flex items-center gap-3">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white text-xs"
                  :style="{ backgroundColor: r.color }">{{ r.icon || '·' }}</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between text-xs">
                <span class="font-medium text-ink truncate">{{ r.name }}</span>
                <span class="money font-semibold text-ink shrink-0 ml-2">¥{{ formatYuan(r.amount) }}</span>
              </div>
              <div class="mt-1 h-1.5 rounded-full bg-surface2 overflow-hidden">
                <div class="h-full rounded-full transition-all" :style="{ width: r.pct + '%', backgroundColor: r.color }" />
              </div>
            </div>
            <span class="text-[11px] text-ink3 shrink-0 w-10 text-right">{{ r.pct.toFixed(1) }}%</span>
            <span v-if="rangeType !== 'month'" class="text-[11px] text-ink3 shrink-0 w-14 text-right hidden md:block">月均 ¥{{ formatYuan(r.monthlyAvg) }}</span>
          </div>
        </div>
      </section>

      <!-- 月度趋势（年视图） -->
      <section v-if="rangeType === 'year'" class="card card-pad">
        <span class="section-title mb-2">{{ selectedYear }} 年月度收支</span>
        <BarChart :labels="yearTrendLabels" :series="yearTrendSeries" :height="200" />
      </section>

      <!-- 全部月份趋势 -->
      <section class="card card-pad">
        <span class="section-title mb-2">全部月份收支趋势</span>
        <BarChart :labels="allTrendLabels" :series="allTrendSeries" :height="200" />
      </section>

      <!-- 年度对比 -->
      <section v-if="availableYears.length > 1" class="card card-pad">
        <span class="section-title mb-3">年度汇总对比</span>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-ink3 text-left border-b border-line">
                <th class="py-2 font-medium">年份</th>
                <th class="py-2 font-medium text-right">收入</th>
                <th class="py-2 font-medium text-right">支出</th>
                <th class="py-2 font-medium text-right">结余</th>
                <th class="py-2 font-medium text-right hidden md:table-cell">储蓄率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="y in yearSummaryRows" :key="y.year" class="border-b border-line/50 last:border-0">
                <td class="py-2 font-medium text-ink">{{ y.year }}</td>
                <td class="py-2 text-right money text-pos">+¥{{ formatYuan(y.income) }}</td>
                <td class="py-2 text-right money text-neg">-¥{{ formatYuan(y.expense) }}</td>
                <td class="py-2 text-right money font-semibold" :class="y.net >= 0 ? 'text-pos' : 'text-neg'">
                  {{ y.net >= 0 ? '+' : '-' }}¥{{ formatYuan(Math.abs(y.net)) }}
                </td>
                <td class="py-2 text-right text-ink3 hidden md:table-cell">{{ y.savingRate }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppShell from '@/components/AppShell.vue'
import PieChart from '@/components/PieChart.vue'
import BarChart from '@/components/BarChart.vue'
import { useLedgerStore } from '@/stores/ledger'
import { formatYuan } from '@/lib/money'

const ledger = useLedgerStore()

onMounted(async () => {
  await ledger.refreshCategories()
  await ledger.refresh()
})

// ---- 范围筛选 ----
type RangeType = 'month' | 'year' | 'all'
type StatType = 'expense' | 'income'
const rangeOptions = [
  { label: '按月', value: 'month' as const },
  { label: '按年', value: 'year' as const },
  { label: '全部', value: 'all' as const }
]
const typeOptions = [
  { label: '支出', value: 'expense' as const },
  { label: '收入', value: 'income' as const }
]
const rangeType = ref<RangeType>('month')
const statType = ref<StatType>('expense')

const now = new Date()
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const currentYear = String(now.getFullYear())

const availableMonths = computed(() => {
  const set = new Set(ledger.transactions.map(t => t.date.slice(0, 7)))
  if (set.size === 0) set.add(currentMonth)
  return Array.from(set).sort().reverse()
})
const availableYears = computed(() => {
  const set = new Set(ledger.transactions.map(t => t.date.slice(0, 4)))
  if (set.size === 0) set.add(currentYear)
  return Array.from(set).sort().reverse()
})

const selectedMonth = ref('')
const selectedYear = ref('')

// 数据异步加载完成后初始化/校正选择: 首屏直接落到最近有数据的月份
watch(availableMonths, (months) => {
  if (!months.includes(selectedMonth.value)) selectedMonth.value = months[0] || currentMonth
}, { immediate: true })
watch(availableYears, (years) => {
  if (!years.includes(selectedYear.value)) selectedYear.value = years[0] || currentYear
}, { immediate: true })

// ---- 范围内交易 ----
const inRange = computed(() => {
  const arr = ledger.transactions
  if (rangeType.value === 'month') return arr.filter(t => t.date.startsWith(selectedMonth.value))
  if (rangeType.value === 'year') return arr.filter(t => t.date.startsWith(selectedYear.value))
  return arr
})

const summary = computed(() => {
  let income = 0, expense = 0
  for (const t of inRange.value) {
    if (t.type === 'income') income += t.amount
    else expense += t.amount
  }
  return { income, expense }
})

// ---- 分类聚合 ----
const PALETTE = ['#10b981', '#6366f1', '#f59e0b', '#38bdf8', '#f472b6', '#a3e635', '#fb923c', '#2dd4bf']

const catAgg = computed(() => {
  const map = new Map<string, number>()
  for (const t of inRange.value) {
    if (t.type !== statType.value) continue
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount)
  }
  const total = Array.from(map.values()).reduce((a, b) => a + b, 0)
  const monthsInRange = rangeType.value === 'month' ? 1
    : rangeType.value === 'all' ? Math.max(1, availableMonths.value.length)
    : Math.max(1, new Set(inRange.value.map(t => t.date.slice(0, 7))).size)
  return Array.from(map.entries())
    .map(([id, amount], i) => {
      const c = ledger.categories.find(c => c.id === id)
      return {
        id,
        name: c?.name || '未分类',
        icon: c?.icon || '·',
        color: c?.color || PALETTE[i % PALETTE.length],
        amount,
        pct: total > 0 ? (amount / total) * 100 : 0,
        monthlyAvg: Math.round(amount / monthsInRange)
      }
    })
    .sort((a, b) => b.amount - a.amount)
})

const catLabels = computed(() => catAgg.value.map(c => c.name))
const catValues = computed(() => catAgg.value.map(c => c.amount))
const catColors = computed(() => catAgg.value.map(c => c.color))
const catRanking = computed(() => catAgg.value)

// ---- 年视图: 月度趋势 ----
const yearTrendLabels = computed(() => Array.from({ length: 12 }, (_, i) => String(i + 1) + '月'))
const yearTrendSeries = computed(() => {
  const income = Array.from({ length: 12 }, () => 0)
  const expense = Array.from({ length: 12 }, () => 0)
  for (const t of ledger.transactions) {
    if (!t.date.startsWith(selectedYear.value)) continue
    const m = parseInt(t.date.slice(5, 7), 10) - 1
    if (t.type === 'income') income[m] += t.amount
    else expense[m] += t.amount
  }
  return [
    { label: '收入', values: income, color: '#10b981' },
    { label: '支出', values: expense, color: '#fb7185' }
  ]
})

// ---- 全部月份趋势 ----
const allTrendLabels = computed(() => availableMonths.value.slice().reverse().map(m => m.slice(2)))
const allTrendSeries = computed(() => [
  { label: '收入', values: availableMonths.value.slice().reverse().map(m => ledger.monthStats.get(m)?.income || 0), color: '#10b981' },
  { label: '支出', values: availableMonths.value.slice().reverse().map(m => ledger.monthStats.get(m)?.expense || 0), color: '#fb7185' }
])

// ---- 年度汇总 ----
const yearSummaryRows = computed(() => {
  const map = new Map<string, { income: number; expense: number }>()
  for (const t of ledger.transactions) {
    const y = t.date.slice(0, 4)
    const row = map.get(y) || { income: 0, expense: 0 }
    if (t.type === 'income') row.income += t.amount
    else row.expense += t.amount
    map.set(y, row)
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([year, r]) => ({
      year,
      income: r.income,
      expense: r.expense,
      net: r.income - r.expense,
      savingRate: r.income > 0 ? (((r.income - r.expense) / r.income) * 100).toFixed(1) + '%' : '—'
    }))
})
</script>
