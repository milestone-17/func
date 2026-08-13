<template>
  <AppShell>
    <div class="space-y-4 pb-32">
      <!-- 顶部: 基金信息 -->
      <header class="space-y-1">
        <button @click="back" class="text-xs text-ink3 flex items-center gap-1">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          返回投资
        </button>
        <div class="flex items-baseline gap-2">
          <h2 class="text-xl font-bold tracking-tight">{{ view?.name || '—' }}</h2>
          <span class="text-xs text-ink3">{{ view?.symbol }}</span>
        </div>
        <div class="flex items-center gap-2 text-xs text-ink3">
          <span v-if="view" class="rounded-md bg-brand-soft px-1.5 py-0.5 text-brand">{{ categoryLabel(view.category) }}</span>
          <span v-if="view">T+{{ view.settleDays || 0 }}</span>
          <span v-if="view && view.isClosed" class="rounded-md bg-rose-100 text-rose-700 px-1.5 py-0.5">已清仓</span>
        </div>
      </header>

      <!-- 净值/收益概览 -->
      <section v-if="view" class="card card-pad bg-gradient-to-br from-sky-500 to-sky-700 text-white border-0">
        <div class="text-xs text-white/80">持有份额 · 净值估算</div>
        <div class="mt-1 flex items-baseline gap-2">
          <span class="money text-3xl font-bold tracking-tight">{{ view.quantity.toFixed(2) }}</span>
          <span class="text-xs text-white/80">份</span>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div>
            <div class="text-[11px] text-white/70">参考市值</div>
            <div class="money font-bold">¥{{ formatYuan(view.marketValueCNY || 0) }}</div>
          </div>
          <div>
            <div class="text-[11px] text-white/70">持有收益</div>
            <div class="money font-bold" :class="(view.unrealized || 0) >= 0 ? 'text-emerald-100' : 'text-rose-200'">
              {{ (view.unrealized || 0) >= 0 ? '+' : '' }}¥{{ formatYuan(view.unrealized || 0) }}
              <span class="text-xs">({{ (view.unrealizedPct ?? 0).toFixed(2) }}%)</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 关键数据网格 -->
      <section v-if="view" class="card card-pad grid grid-cols-3 gap-2 text-center">
        <div class="rounded-lg bg-surface2 py-1.5">
          <div class="text-[10px] text-ink3">成本价</div>
          <div class="money text-sm font-semibold">{{ fenToYuan(view.avgCost).toFixed(4) }}</div>
        </div>
        <div class="rounded-lg bg-surface2 py-1.5">
          <div class="text-[10px] text-ink3">现价<span v-if="view.currentPriceIsEstimate" class="ml-0.5 text-amber-500">·估</span></div>
          <div class="money text-sm font-semibold">{{ view.currentPrice != null ? fenToYuan(view.currentPrice).toFixed(4) : '—' }}</div>
        </div>
        <div class="rounded-lg bg-surface2 py-1.5">
          <div class="text-[10px] text-ink3">总成本</div>
          <div class="money text-sm font-semibold">¥{{ formatYuan(view.totalCost) }}</div>
        </div>
      </section>

      <!-- 在途/冻结 -->
      <section v-if="view && (view.pendingBuyFen > 0 || view.pendingSellFen > 0 || view.frozenShares > 0)" class="card card-pad">
        <div class="text-xs font-semibold mb-2">在途资金 / 冻结份额</div>
        <div v-if="view.pendingBuyFen > 0" class="flex justify-between text-xs">
          <span class="text-ink3">确认中买入</span>
          <span class="money">¥{{ formatYuan(view.pendingBuyFen) }}</span>
        </div>
        <div v-if="view.pendingSellFen > 0" class="flex justify-between text-xs">
          <span class="text-ink3">卖出在途资金</span>
          <span class="money">¥{{ formatYuan(view.pendingSellFen) }}</span>
        </div>
        <div v-if="view.frozenShares > 0" class="flex justify-between text-xs">
          <span class="text-ink3">冻结份额</span>
          <span class="money">{{ view.frozenShares.toFixed(2) }}</span>
        </div>
      </section>

      <!-- 净值走势 -->
      <section v-if="view && view.symbol && /^\d{6}$/.test(view.symbol)" class="card card-pad">
        <div class="flex items-center justify-between mb-2">
          <span class="section-title">净值走势</span>
          <span class="text-[11px] text-ink3" v-if="trendPoints.length > 0">近 {{ trendPoints.length }} 日</span>
        </div>
        <div v-if="trendLoading" class="text-center text-xs text-ink3 py-6">加载中…</div>
        <div v-else-if="trendPoints.length < 2" class="text-center text-xs text-ink3 py-6">暂无历史净值数据</div>
        <LineChart v-else :labels="trendLabels" :series="trendSeries" :height="200" />
      </section>

      <!-- 交易记录 -->
      <section class="card card-pad">
        <div class="text-xs font-semibold mb-2">交易记录 ({{ txns.length }})</div>
        <div v-if="txns.length === 0" class="text-center text-xs text-ink3 py-6">暂无交易记录</div>
        <div v-else class="divide-y divide-line">
          <div v-for="t in txns" :key="t.id" class="py-2.5 flex items-center justify-between">
            <div class="min-w-0">
              <div class="text-xs flex items-center gap-1.5">
                <span :class="t.side === 'buy' ? 'text-pos' : 'text-neg'">{{ sideLabel(t.side) }}</span>
                <span class="text-ink3">{{ t.date }}</span>
                <span v-if="t.note" class="text-ink3 truncate">· {{ t.note }}</span>
              </div>
              <div class="text-[11px] text-ink3 mt-0.5">
                {{ t.quantity?.toFixed(2) }} 份 × {{ t.price != null ? fenToYuan(t.price).toFixed(4) : '—' }}
                <span v-if="t.fee" class="ml-1">· 费 ¥{{ formatYuan(t.fee) }}</span>
              </div>
            </div>
            <div class="text-right text-xs">
              <div class="money font-semibold">¥{{ t.amount != null ? formatYuan(t.amount) : (t.price != null && t.quantity != null ? formatYuan(Math.round(t.price * t.quantity)) : '0.00') }}</div>
              <div class="text-[10px] mt-0.5" :class="settlementClass(t)">{{ settlementLabel(t) }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- 底部固定操作栏 (位于 AppShell tabbar 之上) -->
      <nav class="fixed inset-x-0 z-40 bg-surface border-t border-line px-4 py-2 grid grid-cols-4 gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]"
        style="bottom: calc(60px + env(safe-area-inset-bottom, 0px))">
        <button @click="nav('add')" class="rounded-xl bg-pos/10 text-pos py-2 text-xs font-medium">+ 加仓</button>
        <button @click="nav('reduce')" :disabled="!view || view.quantity === 0" class="rounded-xl bg-neg/10 text-neg py-2 text-xs font-medium disabled:opacity-40">− 减仓</button>
        <button @click="nav('convert')" class="rounded-xl bg-brand-soft text-brand py-2 text-xs font-medium">⇄ 转换</button>
        <button @click="nav('dca')" class="rounded-xl bg-amber-100 text-amber-700 py-2 text-xs font-medium">定投</button>
      </nav>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import LineChart from '@/components/LineChart.vue'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import { formatYuan, fenToYuan } from '@/lib/money'
import { isSettled } from '@/lib/settlement'
import { fetchFundNavTrend, type NavTrendPoint } from '@/lib/fundQuote'
import type { HoldingTxn, HoldingCategory } from '@/types/portfolio'

const route = useRoute()
const router = useRouter()
const portfolio = usePortfolioStore()
const settings = useSettingsStore()

const view = computed(() => portfolio.holdings.find(h => h.id === route.params.id))
const txns = ref<HoldingTxn[]>([])
const trendLoading = ref(false)
const trendPoints = ref<NavTrendPoint[]>([])

function todayISO(): string { return new Date().toISOString().slice(0, 10) }

const trendLabels = computed(() => trendPoints.value.map(p => p.date.slice(5)))
const trendSeries = computed(() => {
  const data = trendPoints.value.map(p => p.nav)
  if (data.length === 0) return []
  return [
    { label: '单位净值', data, color: '#10b981', fill: true }
  ]
})

async function loadTrend() {
  if (!view.value || !/^\d{6}$/.test(view.value.symbol)) {
    trendPoints.value = []
    return
  }
  trendLoading.value = true
  try {
    const pts = await fetchFundNavTrend(view.value.symbol)
    trendPoints.value = pts.slice(-180) // 近半年
  } catch {
    trendPoints.value = []
  } finally {
    trendLoading.value = false
  }
}

async function loadTxns() {
  if (!view.value) { txns.value = []; return }
  const { holdingTxnRepo } = await import('@/repos/holdingTxnRepo')
  txns.value = await holdingTxnRepo.listByHolding(view.value.id)
}

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  await portfolio.refresh()
  await loadTxns()
  await loadTrend()
})

watch(() => route.params.id, async () => {
  await portfolio.refresh()
  await loadTxns()
  await loadTrend()
})

function back() { router.push('/portfolio') }
function nav(action: 'add' | 'reduce' | 'convert' | 'dca') {
  // 通过 query 跳回投资页并打开对应抽屉 (在投资页处理)
  router.push({ path: '/portfolio', query: { holding: String(view.value?.id || ''), action } })
}

const categoryLabelMap: Record<HoldingCategory | 'all', string> = {
  all: '全部', nasdaq100: '纳斯达克100', sp500: '标普500', bond: '债券', dividend: '红利', other: '其他'
}
function categoryLabel(c: HoldingCategory) { return categoryLabelMap[c] ?? c }

function sideLabel(side: HoldingTxn['side']) {
  return ({ buy: '买入', sell: '卖出', dividend: '分红', fee: '费用' } as const)[side]
}

function settlementLabel(t: HoldingTxn): string {
  if (!view.value) return ''
  const today = todayISO()
  const settled = isSettled(t.date, view.value.settleDays, today)
  if (t.side === 'buy') return settled ? '已确认' : `确认中 · ${confirmDateLabel(t)}`
  if (t.side === 'sell') return settled ? '已到账' : `在途 · ${confirmDateLabel(t)}`
  return ''
}
function confirmDateLabel(t: HoldingTxn): string {
  if (!view.value || view.value.settleDays <= 0) return '即时'
  const d = new Date(t.date)
  d.setUTCDate(d.getUTCDate() + view.value.settleDays)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
function settlementClass(t: HoldingTxn): string {
  if (!view.value) return 'text-ink3'
  const settled = isSettled(t.date, view.value.settleDays, todayISO())
  if (settled) return 'text-ink3'
  return 'text-amber-600'
}
</script>
