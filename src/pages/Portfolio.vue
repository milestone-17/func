<template>
  <AppShell>
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold tracking-tight">投资组合</h2>
        <div class="flex items-center gap-2">
          <button @click="refreshAll" :disabled="autoRefreshing" class="btn-ghost">
            <svg class="h-4 w-4" :class="autoRefreshing ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
            {{ autoRefreshing ? '拉取中' : '拉取全部' }}
          </button>
          <button @click="openCreate()" class="btn-primary">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            新增
          </button>
        </div>
      </div>

      <!-- 总览 -->
      <section class="card card-pad bg-gradient-to-br from-sky-500 to-sky-700 text-white border-0">
        <div class="text-xs font-medium text-white/80">{{ activeCategory === 'all' ? '持仓总市值' : '当前分类小计' }}</div>
        <div class="money mt-1 text-3xl font-bold tracking-tight">¥{{ formatYuan(activeSubtotal) }}</div>
        <div class="mt-1 flex items-center gap-1.5 text-sm">
          <svg v-if="portfolio.totalUnrealized >= 0" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          <svg v-else class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
          <span :class="portfolio.totalUnrealized >= 0 ? 'text-emerald-100' : 'text-rose-200'">
            {{ portfolio.totalUnrealized >= 0 ? '+' : '' }}{{ formatYuan(portfolio.totalUnrealized) }}
            (成本 ¥{{ formatYuan(portfolio.totalCost) }})
          </span>
        </div>
      </section>

      <!-- 拉取状态提示 -->
      <div v-if="syncMsg" class="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">{{ syncMsg }}</div>

      <!-- 分类筛选 -->
      <div class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button v-for="c in categories" :key="c.key" @click="activeCategory = c.key"
          :class="['shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                   activeCategory === c.key ? 'bg-brand text-white' : 'bg-surface2 text-ink2 hover:text-ink']">
          {{ c.label }}
          <span class="ml-1 opacity-70">{{ categoryCount(c.key) }}</span>
        </button>
      </div>
      <div class="flex justify-end">
        <button @click="reclassify" :disabled="reclassifying" class="text-[11px] text-brand font-medium">
          {{ reclassifying ? '分类中…' : '一键自动分类(未分类)' }}
        </button>
      </div>

      <!-- 空状态 -->
      <div v-if="filteredHoldings.length === 0" class="card card-pad text-center py-12">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-ink3">
          <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
        </div>
        <p class="mt-2 text-sm text-ink3">{{ activeCategory === 'all' ? '还没有持仓,点击右上角添加' : '该分类下暂无持仓' }}</p>
      </div>

      <!-- 持仓卡片 -->
      <div v-for="h in filteredHoldings" :key="h.id" class="card card-pad space-y-3 fade-in">
        <div class="flex items-start justify-between">
          <button @click="goDetail(h.id)" class="min-w-0 text-left flex-1 active:opacity-70">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-ink truncate">{{ h.name }}</span>
              <span class="rounded-md bg-surface2 px-1.5 py-0.5 text-[10px] text-ink3">{{ h.symbol }}</span>
              <span v-if="h.category !== 'other'" class="rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand">{{ categoryLabel(h.category) }}</span>
            </div>
            <div class="mt-0.5 text-[11px] text-ink3">{{ marketLabel(h.market) }} · {{ currencyLabel(h.currency) }} · T+{{ h.settleDays || 0 }}</div>
          </button>
          <button @click="askDelete(h.id)" class="text-ink3 hover:text-neg p-1" aria-label="删除">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>

        <!-- 数据网格 -->
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-lg bg-surface2 py-1.5">
            <div class="text-[10px] text-ink3">数量</div>
            <div class="money text-sm font-semibold">{{ h.quantity }}</div>
          </div>
          <div class="rounded-lg bg-surface2 py-1.5">
            <div class="text-[10px] text-ink3">均价</div>
            <div class="money text-sm font-semibold">{{ fenToYuan(h.avgCost).toFixed(2) }}</div>
          </div>
          <div class="rounded-lg bg-surface2 py-1.5">
            <div class="text-[10px] text-ink3">现价<span v-if="h.currentPriceIsEstimate" class="ml-0.5 text-amber-500">·估</span></div>
            <div class="money text-sm font-semibold">{{ h.currentPrice != null ? fenToYuan(h.currentPrice).toFixed(2) : '—' }}</div>
          </div>
        </div>

        <!-- 盈亏 -->
        <div v-if="h.currentPrice != null" class="flex items-center justify-between rounded-xl px-3 py-2"
             :class="(h.unrealized || 0) >= 0 ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-rose-50 dark:bg-rose-500/10'">
          <span class="text-xs text-ink2">浮动盈亏</span>
          <div class="text-right">
            <span class="money font-bold" :class="(h.unrealized || 0) >= 0 ? 'text-pos' : 'text-neg'">
              {{ (h.unrealized || 0) >= 0 ? '+' : '' }}¥{{ formatYuan(h.unrealized || 0) }}
            </span>
            <span class="money ml-1 text-xs" :class="(h.unrealizedPct || 0) >= 0 ? 'text-pos' : 'text-neg'">
              ({{ (h.unrealizedPct ?? 0).toFixed(2) }}%)
            </span>
          </div>
        </div>

        <!-- 现价操作 -->
        <div class="flex items-center gap-2">
          <div class="flex flex-1 items-center rounded-lg border border-line bg-surface px-2">
            <span class="text-ink3 text-sm">¥</span>
            <input v-model.number="priceDrafts[h.id]" @blur="commitPrice(h.id)" type="number" step="0.01"
              placeholder="更新现价" class="money w-full min-w-0 bg-transparent py-1.5 text-right text-sm text-ink focus:outline-none" />
          </div>
          <button @click="refreshPrice(h)" :disabled="refreshingId === h.id" class="btn-ghost !py-1.5 !text-xs">
            <svg class="h-3.5 w-3.5" :class="refreshingId === h.id ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
            拉取
          </button>
        </div>

        <!-- 加仓/减仓/转换 -->
        <div class="grid grid-cols-3 gap-2">
          <button @click="openTrade(h, 'add')" class="btn-ghost !py-2 !text-xs !text-pos">+ 加仓</button>
          <button @click="openTrade(h, 'reduce')" class="btn-ghost !py-2 !text-xs !text-neg" :disabled="h.quantity === 0">− 减仓</button>
          <button @click="openConvert(h)" class="btn-ghost !py-2 !text-xs">⇄ 转换</button>
        </div>
        <div v-if="h.isClosed" class="text-center text-[11px] text-ink3">已清仓</div>
      </div>

      <ConfirmDialog v-model="confirming" title="删除持仓" message="将删除该持仓及其交易记录,此操作不可撤销。" @confirm="doDelete" />

      <!-- 加仓/减仓抽屉 -->
      <div v-if="trading" class="sheet" @click.self="closeTrade">
        <div class="sheet-panel space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">{{ trading.mode === 'add' ? '加仓' : '减仓' }} · {{ trading.holding.name }}</h3>
            <button @click="closeTrade" class="text-ink3">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="text-[11px] text-ink3">
            现价 {{ trading.holding.currentPrice != null ? fenToYuan(trading.holding.currentPrice).toFixed(4) : '—' }} ·
            持有 {{ trading.holding.quantity }} 份
            <span v-if="trading.holding.settleDays > 0" class="ml-1">(结算 T+{{ trading.holding.settleDays }})</span>
          </div>
          <div class="flex gap-1.5">
            <button v-for="m in (['amount','shares'] as const)" :key="m" @click="trading.input.mode = m"
              :class="['flex-1 rounded-lg py-1.5 text-xs font-medium',
                       trading.input.mode === m ? 'bg-brand text-white' : 'bg-surface2 text-ink2']">
              {{ m === 'amount' ? '按金额' : '按份额' }}
            </button>
          </div>
          <div>
            <label class="label">{{ trading.input.mode === 'amount' ? '金额 (元)' : '份额' }}</label>
            <input v-model.number="trading.input.value" type="number" step="any" placeholder="0" class="input money" />
          </div>
          <div>
            <label class="label">手续费 (元, 可选)</label>
            <input v-model.number="trading.input.fee" type="number" step="0.01" placeholder="0" class="input money" />
          </div>
          <div v-if="tradePreview" class="rounded-xl bg-surface2 px-3 py-2 text-xs space-y-1">
            <div class="flex justify-between"><span class="text-ink3">预计份额</span><span class="money font-semibold">{{ tradePreview.quantity.toFixed(4) }}</span></div>
            <div v-if="tradePreview.estimatedAmount" class="flex justify-between"><span class="text-ink3">预计金额</span><span class="money">¥{{ tradePreview.estimatedAmount.toFixed(2) }}</span></div>
            <div class="flex justify-between"><span class="text-ink3">结算</span><span>{{ tradePreview.confirmLabel }}</span></div>
          </div>
          <div v-if="tradeError" class="rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-xs text-neg">{{ tradeError }}</div>
          <div class="flex gap-2 pt-1">
            <button class="btn-ghost flex-1" @click="closeTrade">取消</button>
            <button class="btn-primary flex-1" :disabled="tradePending" @click="confirmTrade">{{ tradePending ? '提交中…' : '确认' }}</button>
          </div>
        </div>
      </div>

      <!-- 新增抽屉 -->
      <div v-if="creating" class="sheet" @click.self="creating = false">
        <div class="sheet-panel space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">新增持仓</h3>
            <button @click="creating = false" class="text-ink3">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div>
            <label class="label">代码</label>
            <input v-model="form.symbol" type="text" placeholder="如 QQQ / 600519" class="input" />
          </div>
          <div>
            <label class="label">名称</label>
            <input v-model="form.name" type="text" placeholder="如 纳指100 ETF" class="input" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="label">市场</label>
              <select v-model="form.market" class="input">
                <option value="US">美股</option>
                <option value="CN">A股</option>
                <option value="HK">港股</option>
              </select>
            </div>
            <div>
              <label class="label">分类</label>
              <select v-model="form.category" @change="onCategoryChange" class="input">
                <option v-for="c in categoryOptions" :key="c.key" :value="c.key">{{ c.label }}</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="label">类型</label>
              <select v-model="form.type" class="input">
                <option value="stock">股票</option>
                <option value="etf">ETF/基金</option>
                <option value="bond">债券</option>
                <option value="cash">现金</option>
                <option value="gold">黄金</option>
              </select>
            </div>
            <AmountInput v-model="form.avgCost" label="均价 (元)" />
          </div>
          <div>
            <label class="label">数量</label>
            <input v-model.number="form.quantity" type="number" step="any" placeholder="0" class="input money" />
          </div>
          <button @click="save" :disabled="!canSave" class="btn-primary w-full !py-3">保存</button>
        </div>
      </div>

      <!-- 转换抽屉 -->
      <div v-if="converting" class="sheet" @click.self="closeConvert">
        <div class="sheet-panel space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">转换 · {{ converting.holding.name }} → {{ converting.target.symbol }}</h3>
            <button @click="closeConvert" class="text-ink3">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div>
            <label class="label">转出方式</label>
            <div class="flex gap-1.5">
              <button v-for="m in (['all','amount','shares'] as const)" :key="m" @click="converting.input.mode = m"
                :class="['flex-1 rounded-lg py-1.5 text-xs font-medium',
                         converting.input.mode === m ? 'bg-brand text-white' : 'bg-surface2 text-ink2']">
                {{ m === 'all' ? '全部' : m === 'amount' ? '按金额' : '按份额' }}
              </button>
            </div>
          </div>
          <div v-if="converting.input.mode !== 'all'">
            <label class="label">{{ converting.input.mode === 'amount' ? '金额 (元)' : '份额' }}</label>
            <input v-model.number="converting.input.value" type="number" step="any" placeholder="0" class="input money" />
          </div>
          <div>
            <label class="label">转入基金代码</label>
            <input v-model="converting.target.symbol" @blur="resolveTarget" type="text" placeholder="如 006260" class="input" />
          </div>
          <div>
            <label class="label">转入基金名称 (留空用代码)</label>
            <input v-model="converting.target.name" type="text" placeholder="如 易方达债券" class="input" />
          </div>
          <div>
            <label class="label">转入净值 (元, 自动识别失败手动填)</label>
            <input v-model.number="converting.target.priceYuan" type="number" step="0.0001" placeholder="0.0000" class="input money" />
          </div>
          <div v-if="convertPreview" class="rounded-xl bg-surface2 px-3 py-2 text-xs space-y-1">
            <div class="flex justify-between"><span class="text-ink3">转出金额</span><span class="money">¥{{ convertPreview.grossYuan.toFixed(2) }}</span></div>
            <div class="flex justify-between"><span class="text-ink3">转入确认份额</span><span class="money font-semibold">{{ convertPreview.targetShares.toFixed(4) }}</span></div>
            <div class="flex justify-between"><span class="text-ink3">转出确认日</span><span>{{ convertPreview.sourceConfirm }}</span></div>
            <div class="flex justify-between"><span class="text-ink3">转入确认日</span><span>{{ convertPreview.targetConfirm }}</span></div>
            <div class="flex justify-between"><span class="text-ink3">收益起算日</span><span class="font-semibold text-brand">{{ convertPreview.earningsStart }}</span></div>
          </div>
          <div v-if="convertError" class="rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-xs text-neg">{{ convertError }}</div>
          <div class="flex gap-2 pt-1">
            <button class="btn-ghost flex-1" @click="closeConvert">取消</button>
            <button class="btn-primary flex-1" :disabled="convertPending" @click="confirmConvert">{{ convertPending ? '提交中…' : '确认转换' }}</button>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import AmountInput from '@/components/AmountInput.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import { formatYuan, fenToYuan, yuanToFen } from '@/lib/money'
import { inferCategory } from '@/lib/category'
import { confirmDateOf } from '@/lib/settlement'
import { planConversion } from '@/lib/conversion'
import type { Market, Currency, HoldingType, HoldingCategory } from '@/types/portfolio'

type HoldingView = ReturnType<typeof usePortfolioStore>['holdings'][number]
type TradeMode = 'add' | 'reduce'
interface TradeInput { mode: 'amount' | 'shares'; value: number | null; fee: number | null }
interface Trading { mode: TradeMode; holding: HoldingView; input: TradeInput }

const portfolio = usePortfolioStore()
const settings = useSettingsStore()
const route = useRoute()
const router = useRouter()

function goDetail(id: string) {
  router.push(`/holding/${id}`)
}

// 详情页底部操作栏跳回时根据 query 自动打开抽屉
function maybeOpenFromQuery() {
  const id = String(route.query.holding || '')
  const action = String(route.query.action || '')
  if (!id || !action) return
  const h = portfolio.holdings.find(x => x.id === id)
  if (!h) return
  if (action === 'add' || action === 'reduce') {
    openTrade(h, action)
  } else if (action === 'convert') {
    openConvert(h)
  } else if (action === 'dca') {
    router.push({ path: '/dca', query: { target: h.id } })
  }
  // 清除 query 避免重复打开
  router.replace({ path: '/portfolio' })
}

const categories = [
  { key: 'all', label: '全部' },
  { key: 'nasdaq100', label: '纳斯达克100' },
  { key: 'sp500', label: '标普500' },
  { key: 'bond', label: '债券' },
  { key: 'dividend', label: '红利' },
  { key: 'other', label: '其他' }
] as const
const categoryOptions = categories.filter(c => c.key !== 'all')

const activeCategory = ref<HoldingCategory | 'all'>('all')
const filteredHoldings = computed(() =>
  activeCategory.value === 'all' ? portfolio.holdings : portfolio.holdings.filter(h => h.category === activeCategory.value)
)
const activeSubtotal = computed(() => {
  if (activeCategory.value === 'all') return portfolio.totalMarketValueCNY
  return portfolio.byCategory[activeCategory.value]?.marketValueCNY ?? 0
})
function categoryCount(key: string) {
  if (key === 'all') return portfolio.holdings.length
  return portfolio.byCategory[key]?.count ?? 0
}
function categoryLabel(c: HoldingCategory) {
  return categories.find(x => x.key === c)?.label ?? c
}

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  await portfolio.refresh()
  syncDrafts()
  maybeOpenFromQuery()
  // 自动拉取现价 (失败保留原值, 不清空)
  autoRefreshing.value = true
  const r = await portfolio.refreshAllPrices()
  autoRefreshing.value = false
  syncDrafts()
  if (r.updated === 0 && r.failed.length > 0) {
    syncMsg.value = '行情自动拉取失败,已保留上次数据,可点「拉取全部」重试或手动填入'
  } else if (r.failed.length > 0) {
    syncMsg.value = `已更新 ${r.updated} 只,${r.failed.length} 只拉取失败(已保留原值)`
  }
})

function syncDrafts() {
  for (const h of portfolio.holdings) {
    priceDrafts.value[h.id] = h.currentPrice != null ? fenToYuan(h.currentPrice) : null
  }
}

function marketLabel(m: Market) { return ({ US: '美股', CN: 'A股', HK: '港股' } as const)[m] }
function currencyLabel(c: Currency) { return c === 'USD' ? 'USD' : 'CNY' }

const priceDrafts = ref<Record<string, number | null>>({})
const autoRefreshing = ref(false)
const refreshingId = ref<string | null>(null)
const syncMsg = ref('')

async function refreshAll() {
  autoRefreshing.value = true
  syncMsg.value = ''
  const r = await portfolio.refreshAllPrices()
  autoRefreshing.value = false
  syncDrafts()
  if (r.updated === 0 && r.failed.length > 0) {
    syncMsg.value = '行情拉取失败,已保留上次数据,可稍后重试或手动填入'
  } else if (r.failed.length > 0) {
    syncMsg.value = `已更新 ${r.updated} 只,${r.failed.length} 只拉取失败(已保留原值)`
  } else if (r.updated > 0) {
    syncMsg.value = `已更新 ${r.updated} 只持仓现价`
  }
}

async function refreshPrice(h: any) {
  refreshingId.value = h.id
  try {
    const { fetchHoldingPrice } = await import('@/lib/yahoo')
    const r = await fetchHoldingPrice(h.market, h.symbol)
    if (r && r.price > 0) {
      await portfolio.updatePrice(h.id, yuanToFen(r.price), r.isEstimate)
      priceDrafts.value[h.id] = r.price
    } else {
      alert('该标的暂不支持自动拉取或拉取失败,请手动填入现价')
    }
  } catch {
    alert('拉取失败,请手动填入现价')
  } finally {
    refreshingId.value = null
  }
}

async function commitPrice(id: string) {
  const v = priceDrafts.value[id]
  if (v != null && v > 0) await portfolio.updatePrice(id, yuanToFen(v))
}

const creating = ref(false)
const form = ref<{ symbol: string; name: string; market: Market; type: HoldingType; category: HoldingCategory; currency: Currency; avgCost: number | null; quantity: number }>({
  symbol: '', name: '', market: 'US', type: 'etf', category: 'other', currency: 'USD', avgCost: null, quantity: 0
})
const canSave = computed(() => !!form.value.symbol && !!form.value.name && form.value.avgCost != null && form.value.quantity > 0)

function onCategoryChange() {
  categoryTouched.value = true
  applyCategoryTypeDefault()
}

/** 用户未手动选分类时, 按名称/代码自动推断并预填 */
const categoryTouched = ref(false)
function applyCategoryTypeDefault() {
  const c = form.value.category
  if (c === 'bond') form.value.type = 'bond'
  else if (c === 'nasdaq100' || c === 'sp500' || c === 'dividend') form.value.type = 'stock'
}
watch(() => [form.value.name, form.value.symbol], () => {
  if (creating.value && !categoryTouched.value) {
    form.value.category = inferCategory(form.value.name, form.value.symbol)
    applyCategoryTypeDefault()
  }
})

function openCreate() {
  form.value = { symbol: '', name: '', market: 'US', type: 'etf', category: 'other', currency: 'USD', avgCost: null, quantity: 0 }
  categoryTouched.value = false
  creating.value = true
}

const reclassifying = ref(false)
async function reclassify() {
  reclassifying.value = true
  const n = await portfolio.reclassifyAll('unclassified')
  reclassifying.value = false
  syncMsg.value = n > 0 ? `已自动分类 ${n} 只持仓` : '没有需要分类的「其他」持仓'
}

async function save() {
  if (!canSave.value) return
  const currency: Currency = form.value.market === 'US' ? 'USD' : 'CNY'
  const holding = await portfolio.addHolding({
    symbol: form.value.symbol, name: form.value.name, market: form.value.market,
    currency, type: form.value.type, category: form.value.category, quantity: form.value.quantity, avgCost: form.value.avgCost!,
    currentPrice: null, currentPriceAt: null
  })
  await portfolio.addTxn({
    holdingId: holding.id, side: 'buy', date: new Date().toISOString().slice(0, 10),
    price: form.value.avgCost!, quantity: form.value.quantity, fee: 0
  })
  creating.value = false
}

const confirming = ref(false)
const pendingDelete = ref<string | null>(null)
function askDelete(id: string) { pendingDelete.value = id; confirming.value = true }
async function doDelete() {
  if (pendingDelete.value) {
    const { holdingRepo } = await import('@/repos/holdingRepo')
    await holdingRepo.softDelete(pendingDelete.value)
    await portfolio.refresh()
  }
  pendingDelete.value = null
}

// ---- 加仓/减仓抽屉 ----
const trading = ref<Trading | null>(null)
const tradeError = ref('')
const tradePending = ref(false)

function openTrade(h: HoldingView, mode: TradeMode) {
  trading.value = { mode, holding: h, input: { mode: 'amount', value: null, fee: null } }
  tradeError.value = ''
}
function closeTrade() { trading.value = null; tradeError.value = '' }

const tradePreview = computed(() => {
  if (!trading.value || !trading.value.input.value || trading.value.input.value <= 0) return null
  const h = trading.value.holding
  const price = h.currentPrice ?? null
  if (price == null || price <= 0) return null
  const value = trading.value.input.value
  const feeFen = yuanToFen(trading.value.input.fee ?? 0)
  let quantity: number
  let estimatedAmount: number | null = null
  if (trading.value.input.mode === 'amount') {
    const amountFen = yuanToFen(value)
    quantity = amountFen / price
    estimatedAmount = value
  } else {
    quantity = value
    estimatedAmount = value * fenToYuan(price)
  }
  const today = new Date().toISOString().slice(0, 10)
  const confirmDay = h.settleDays > 0 ? confirmDateOf(today, h.settleDays) : today
  const confirmLabel = h.settleDays > 0
    ? `${confirmDay} 确认 (T+${h.settleDays})`
    : '即时 (T+0)'
  return { quantity, estimatedAmount, confirmLabel, feeFen }
})

async function confirmTrade() {
  if (!trading.value) return
  tradeError.value = ''
  tradePending.value = true
  try {
    const { holding: h, mode, input } = trading.value
    if (!input.value || input.value <= 0) {
      tradeError.value = '请输入有效金额或份额'; return
    }
    if (h.currentPrice == null || h.currentPrice <= 0) {
      tradeError.value = '该持仓暂无现价,请先拉取或填入'; return
    }
    const feeFen = yuanToFen(input.fee ?? 0)
    const r = mode === 'add'
      ? await portfolio.addPosition(h.id, { mode: input.mode, value: input.value, feeFen })
      : await portfolio.reducePosition(h.id, { mode: input.mode, value: input.value, feeFen })
    if (!r.ok) {
      tradeError.value = tradeErrorText(r.reason)
      return
    }
    closeTrade()
    syncDrafts()
  } finally {
    tradePending.value = false
  }
}

function tradeErrorText(reason: string): string {
  switch (reason) {
    case 'no-price': return '该持仓暂无现价,请先拉取或填入'
    case 'exceeds-held': return '减仓份额超过持有份额'
    case 'amount-exceeds': return '减仓金额超过持有市值'
    case 'invalid': return '输入无效,请检查金额或份额'
    case 'not-found': return '持仓不存在'
    default: return '操作失败'
  }
}

// ---- 超级转换抽屉 ----
interface ConvertInput { mode: 'all' | 'amount' | 'shares'; value: number | null }
interface ConvertTarget { symbol: string; name: string; priceYuan: number | null }
interface Converting { holding: HoldingView; input: ConvertInput; target: ConvertTarget }

const converting = ref<Converting | null>(null)
const convertError = ref('')
const convertPending = ref(false)

function openConvert(h: HoldingView) {
  converting.value = {
    holding: h,
    input: { mode: 'all', value: null },
    target: { symbol: '', name: '', priceYuan: null }
  }
  convertError.value = ''
}
function closeConvert() { converting.value = null; convertError.value = '' }

async function resolveTarget() {
  if (!converting.value) return
  const sym = converting.value.target.symbol.trim()
  if (!sym) return
  const existing = portfolio.holdings.find(h => h.symbol === sym)
  if (existing) {
    if (!converting.value.target.name) converting.value.target.name = existing.name
    if (existing.currentPrice != null && converting.value.target.priceYuan == null) {
      converting.value.target.priceYuan = fenToYuan(existing.currentPrice)
    }
    return
  }
  // 6 位代码 → 尝试基金批量 JSONP 拉净值
  if (/^\d{6}$/.test(sym)) {
    try {
      const { fetchFundNavs } = await import('@/lib/fundQuote')
      const m = await fetchFundNavs([sym])
      const r = m.get(sym)
      if (r && r.nav > 0) {
        converting.value.target.priceYuan = r.nav
      }
    } catch { /* 忽略, 让用户手填 */ }
  }
}

const convertPreview = computed(() => {
  if (!converting.value) return null
  const { holding, input, target } = converting.value
  if (holding.currentPrice == null || holding.currentPrice <= 0) return null
  if (!target.priceYuan || target.priceYuan <= 0) return null
  const today = new Date().toISOString().slice(0, 10)
  let sourceShares: number | null = null
  let amountFen: number | null = null
  if (input.mode === 'all') {
    sourceShares = holding.quantity
  } else if (input.mode === 'shares') {
    sourceShares = input.value ?? 0
  } else {
    amountFen = yuanToFen(input.value ?? 0)
  }
  if (sourceShares === null && amountFen === null) return null
  if (sourceShares !== null && sourceShares <= 0) return null
  if (amountFen !== null && amountFen <= 0) return null
  try {
    const plan = planConversion({
      sourceShares, amountFen,
      sourcePriceFen: holding.currentPrice, targetPriceFen: yuanToFen(target.priceYuan),
      sourceSettleDays: holding.settleDays,
      targetSettleDays: /^\d{6}$/.test(target.symbol) ? (/纳斯达克|纳指|标普|恒生|中概|海外|全球|美国|qdii/i.test(target.name) ? 2 : 1) : 0,
      todayISO: today
    })
    return {
      grossYuan: plan.grossFen / 100,
      targetShares: plan.targetShares,
      sourceConfirm: plan.sourceConfirmDate,
      targetConfirm: plan.targetConfirmDate,
      earningsStart: plan.earningsStartDate
    }
  } catch (e) {
    return null
  }
})

async function confirmConvert() {
  if (!converting.value) return
  convertError.value = ''
  const { holding, input, target } = converting.value
  if (!target.symbol.trim()) { convertError.value = '请输入转入基金代码'; return }
  if (!target.priceYuan || target.priceYuan <= 0) { convertError.value = '请输入有效的转入净值'; return }
  convertPending.value = true
  try {
    const r = await portfolio.convertPosition(holding.id, {
      symbol: target.symbol.trim(),
      name: target.name.trim() || target.symbol.trim(),
      priceFen: yuanToFen(target.priceYuan)
    }, { mode: input.mode, value: input.value ?? undefined })
    if (!r.ok) {
      convertError.value = convertErrorText(r.reason)
      return
    }
    closeConvert()
    syncDrafts()
  } finally {
    convertPending.value = false
  }
}

function convertErrorText(reason: string): string {
  switch (reason) {
    case 'no-price': return '源持仓暂无现价,请先拉取或填入'
    case 'no-target-price': return '请填入转入基金净值'
    case 'same-target': return '转出与转入不能是同一只基金'
    case 'exceeds-held': return '转出份额超过持有份额'
    case 'amount-exceeds': return '转出金额超过持有市值'
    case 'invalid': return '输入无效,请检查金额或份额'
    case 'not-found': return '源持仓不存在'
    default: return '转换失败'
  }
}
</script>
