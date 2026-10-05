<template>
  <AppShell>
    <div class="space-y-4">
      <!-- 备份提醒 -->
      <section v-if="showBackupReminder" class="card card-pad border-warn/40 bg-warn/5 fade-in">
        <div class="flex items-start gap-3">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warn/15 text-warn">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </span>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-ink">该备份你的数据了</div>
            <p class="mt-0.5 text-xs text-ink2">数据仅存本地,建议定期导出备份到网盘以防丢失。</p>
            <div class="mt-2 flex gap-2">
              <button @click="goBackup" class="btn-primary !py-1.5 !text-xs">立即备份</button>
              <button @click="snoozeReminder" class="btn-ghost !py-1.5 !text-xs">稍后提醒</button>
            </div>
          </div>
        </div>
      </section>

      <!-- Hero: 净资产 -->
      <section class="card card-pad bg-gradient-to-br from-brand to-emerald-700 text-white border-0 shadow-float">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-white/80">投资净资产</span>
          <RouterLink to="/portfolio" class="text-[11px] text-white/80 underline-offset-2 hover:underline">详情</RouterLink>
        </div>
        <div class="money mt-1 text-3xl font-bold tracking-tight">¥{{ portfolioValueStr }}</div>
        <div class="mt-1 flex items-center gap-1.5 text-sm">
          <svg v-if="portfolio.totalUnrealized >= 0" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          <svg v-else class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
          <span :class="portfolio.totalUnrealized >= 0 ? 'text-emerald-100' : 'text-rose-200'">
            {{ portfolio.totalUnrealized >= 0 ? '+' : '' }}{{ unrealizedStr }} ({{ unrealizedPctStr }})
          </span>
        </div>
      </section>

      <!-- 本月收支 -->
      <div class="grid grid-cols-2 gap-3">
        <StatCard label="本月收入" :value="incomeStr" tone="up" prefix="¥" />
        <StatCard label="本月支出" :value="expenseStr" tone="down" prefix="¥" />
      </div>

      <!-- 快捷入口 -->
      <div class="grid grid-cols-4 gap-2">
        <button v-for="q in quickActions" :key="q.label" @click="go(q.to)"
          class="flex flex-col items-center gap-1.5 rounded-2xl bg-surface border border-line py-3 transition active:scale-95 hover:bg-surface2">
          <span class="grid h-9 w-9 place-items-center rounded-xl" :style="{ backgroundColor: q.bg, color: q.fg }">
            <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="q.icon" />
          </span>
          <span class="text-[11px] text-ink2">{{ q.label }}</span>
        </button>
      </div>

      <!-- 近 6 月收支趋势 -->
      <section v-if="trendLabels.length" class="card card-pad">
        <span class="section-title mb-2">近 6 月收支</span>
        <BarChart :labels="trendLabels" :series="trendSeries" :height="180" />
      </section>

      <!-- 资产分配 -->
      <section v-if="allocLabels.length" class="card card-pad">
        <span class="section-title mb-3">资产分配</span>
        <PieChart :labels="allocLabels" :values="allocValues" :height="180" doughnut show-legend />
      </section>

      <!-- 定投状态 -->
      <section class="card card-pad">
        <div class="flex items-center justify-between">
          <span class="section-title">智能定投</span>
          <RouterLink to="/dca" class="text-[11px] text-brand font-medium">查看 →</RouterLink>
        </div>
        <div v-if="dca.config" class="mt-2 flex items-center justify-between">
          <div>
            <div class="text-xs text-ink3">最新价 / MA250</div>
            <div class="money text-sm font-semibold">
              {{ dca.lastClose != null ? dca.lastClose.toFixed(2) : '—' }}
              <span class="text-ink3 font-normal">/ {{ dca.ma250 != null ? dca.ma250.toFixed(2) : '—' }}</span>
            </div>
          </div>
          <Badge :tone="dca.bucket?.side === 'high' ? 'red' : dca.bucket?.side === 'low' ? 'green' : 'blue'">
            {{ dca.bucket?.label || '—' }}
          </Badge>
        </div>
        <div v-else class="mt-2 text-sm text-ink3">
          尚未配置 <RouterLink to="/dca" class="text-brand font-medium">前往设置 →</RouterLink>
        </div>
      </section>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import StatCard from '@/components/StatCard.vue'
import Badge from '@/components/Badge.vue'
import BarChart from '@/components/BarChart.vue'
import PieChart from '@/components/PieChart.vue'
import { useLedgerStore } from '@/stores/ledger'
import { usePortfolioStore } from '@/stores/portfolio'
import { useDcaStore } from '@/stores/dca'
import { useSettingsStore } from '@/stores/settings'
import { formatYuan } from '@/lib/money'
import { shouldRemindBackup } from '@/lib/backupReminder'

const ledger = useLedgerStore()
const portfolio = usePortfolioStore()
const dca = useDcaStore()
const settings = useSettingsStore()
const router = useRouter()

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  await Promise.all([ledger.refreshCategories(), ledger.refresh(), portfolio.refresh(), dca.load()])
})

function go(to: string) { router.push(to) }

// ---- 备份提醒 ----
const reminderSnoozedLocal = ref(false)
const firstDataAt = computed(() => {
  const ts = ledger.transactions.map(t => t.createdAt).filter(Number.isFinite)
  return ts.length ? Math.min(...ts) : null
})
const showBackupReminder = computed(() => {
  if (reminderSnoozedLocal.value) return false
  const s = settings.settings
  if (!s) return false
  return shouldRemindBackup({
    lastBackupAt: s.lastBackupAt,
    firstDataAt: firstDataAt.value,
    snoozedAt: s.backupReminderSnoozedAt,
    reminderDays: s.backupReminderDays,
    now: Date.now()
  })
})
function goBackup() { router.push('/settings') }
async function snoozeReminder() {
  reminderSnoozedLocal.value = true
  await settings.save({ backupReminderSnoozedAt: Date.now() })
}

// 本月
const currentMonth = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})
const monthStat = computed(() => ledger.monthStats.get(currentMonth.value) || { income: 0, expense: 0 })
const incomeStr = computed(() => formatYuan(monthStat.value.income))
const expenseStr = computed(() => formatYuan(monthStat.value.expense))

// 净资产
const portfolioValueStr = computed(() => formatYuan(portfolio.totalMarketValueCNY))
const unrealizedStr = computed(() => formatYuan(portfolio.totalUnrealized))
const unrealizedPctStr = computed(() => {
  const c = portfolio.totalCost
  if (c <= 0) return '0.00%'
  return ((portfolio.totalUnrealized / c) * 100).toFixed(2) + '%'
})

// 近 6 月趋势
const trendLabels = computed(() => {
  const months: string[] = []
  const d = new Date()
  for (let i = 5; i >= 0; i--) {
    const dd = new Date(d.getFullYear(), d.getMonth() - i, 1)
    months.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`)
  }
  return months.map(m => m.slice(5))
})
const trendSeries = computed(() => {
  const d = new Date()
  const keys: string[] = []
  for (let i = 5; i >= 0; i--) {
    const dd = new Date(d.getFullYear(), d.getMonth() - i, 1)
    keys.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`)
  }
  return [
    { label: '收入', values: keys.map(k => ledger.monthStats.get(k)?.income || 0), color: '#10b981' },
    { label: '支出', values: keys.map(k => ledger.monthStats.get(k)?.expense || 0), color: '#fb7185' }
  ]
})

// 资产分配 (按持仓 type 聚合市值)
const TYPE_META: Record<string, { label: string; color: string }> = {
  stock: { label: '股票', color: '#10b981' },
  etf: { label: 'ETF/基金', color: '#6366f1' },
  bond: { label: '债券', color: '#38bdf8' },
  cash: { label: '现金', color: '#f59e0b' },
  gold: { label: '黄金', color: '#fbbf24' }
}
const allocLabels = computed(() => {
  const groups = groupByType()
  return groups.map(g => TYPE_META[g.type]?.label || g.type)
})
const allocValues = computed(() => groupByType().map(g => g.value))
function groupByType() {
  const map = new Map<string, number>()
  for (const h of portfolio.holdings) {
    const v = h.marketValueCNY || 0
    if (v <= 0) continue
    map.set(h.type, (map.get(h.type) || 0) + v)
  }
  return Array.from(map.entries())
    .map(([type, value]) => ({ type, value }))
    .sort((a, b) => b.value - a.value)
}

// 快捷入口
const ICONS = {
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'
}
const quickActions = [
  { label: '记一笔', to: '/ledger', icon: ICONS.plus, bg: 'rgba(16,185,129,0.12)', fg: '#10b981' },
  { label: '预算', to: '/budget', icon: ICONS.pie, bg: 'rgba(99,102,241,0.12)', fg: '#6366f1' },
  { label: '投资', to: '/portfolio', icon: ICONS.trend, bg: 'rgba(56,189,248,0.12)', fg: '#38bdf8' },
  { label: '永久', to: '/permanent', icon: ICONS.shield, bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' }
]
</script>
