<template>
  <AppShell>
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold tracking-tight">投资组合</h2>
        <button @click="openCreate()" class="btn-primary">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          新增
        </button>
      </div>

      <!-- 总览 -->
      <section class="card card-pad bg-gradient-to-br from-sky-500 to-sky-700 text-white border-0">
        <div class="text-xs font-medium text-white/80">持仓总市值</div>
        <div class="money mt-1 text-3xl font-bold tracking-tight">¥{{ formatYuan(portfolio.totalMarketValueCNY) }}</div>
        <div class="mt-1 flex items-center gap-1.5 text-sm">
          <svg v-if="portfolio.totalUnrealized >= 0" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          <svg v-else class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
          <span :class="portfolio.totalUnrealized >= 0 ? 'text-emerald-100' : 'text-rose-200'">
            {{ portfolio.totalUnrealized >= 0 ? '+' : '' }}{{ formatYuan(portfolio.totalUnrealized) }}
            (成本 ¥{{ formatYuan(portfolio.totalCost) }})
          </span>
        </div>
      </section>

      <!-- 空状态 -->
      <div v-if="portfolio.holdings.length === 0" class="card card-pad text-center py-12">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-ink3">
          <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
        </div>
        <p class="mt-2 text-sm text-ink3">还没有持仓,点击右上角添加</p>
      </div>

      <!-- 持仓卡片 -->
      <div v-for="h in portfolio.holdings" :key="h.id" class="card card-pad space-y-3 fade-in">
        <div class="flex items-start justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-ink truncate">{{ h.name }}</span>
              <span class="rounded-md bg-surface2 px-1.5 py-0.5 text-[10px] text-ink3">{{ h.symbol }}</span>
            </div>
            <div class="mt-0.5 text-[11px] text-ink3">{{ marketLabel(h.market) }} · {{ currencyLabel(h.currency) }}</div>
          </div>
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
            <div class="text-[10px] text-ink3">现价</div>
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
          <button @click="refreshPrice(h)" class="btn-ghost !py-1.5 !text-xs">
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
            拉取
          </button>
        </div>
      </div>

      <ConfirmDialog v-model="confirming" title="删除持仓" message="将删除该持仓及其交易记录,此操作不可撤销。" @confirm="doDelete" />

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
              <label class="label">类型</label>
              <select v-model="form.type" class="input">
                <option value="stock">股票</option>
                <option value="etf">ETF/基金</option>
                <option value="bond">债券</option>
                <option value="cash">现金</option>
                <option value="gold">黄金</option>
              </select>
            </div>
          </div>
          <AmountInput v-model="form.avgCost" label="均价 (元)" />
          <div>
            <label class="label">数量</label>
            <input v-model.number="form.quantity" type="number" step="any" placeholder="0" class="input money" />
          </div>
          <button @click="save" :disabled="!canSave" class="btn-primary w-full !py-3">保存</button>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import AppShell from '@/components/AppShell.vue'
import AmountInput from '@/components/AmountInput.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import { formatYuan, fenToYuan, yuanToFen } from '@/lib/money'
import type { Market, Currency, HoldingType } from '@/types/portfolio'

const portfolio = usePortfolioStore()
const settings = useSettingsStore()

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  await portfolio.refresh()
  for (const h of portfolio.holdings) {
    priceDrafts.value[h.id] = h.currentPrice != null ? fenToYuan(h.currentPrice) : null
  }
})

function marketLabel(m: Market) { return ({ US: '美股', CN: 'A股', HK: '港股' } as const)[m] }
function currencyLabel(c: Currency) { return c === 'USD' ? 'USD' : 'CNY' }

const priceDrafts = ref<Record<string, number | null>>({})

async function refreshPrice(h: any) {
  if (h.market === 'US') {
    const symbol = h.symbol.toLowerCase() + '.us'
    try {
      const to = new Date().toISOString().slice(0, 10)
      const from = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)
      const { fetchStooqBars } = await import('@/lib/stooq')
      const bars = await fetchStooqBars(symbol, from, to)
      if (bars.length > 0) {
        await portfolio.updatePrice(h.id, yuanToFen(bars[bars.length - 1].close))
        priceDrafts.value[h.id] = bars[bars.length - 1].close
      }
    } catch { priceDrafts.value[h.id] = null }
  } else if (h.market === 'CN') {
    try {
      const secid = h.symbol.startsWith('6') ? `1.${h.symbol}` : `0.${h.symbol}`
      const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43`
      const res = await fetch(url)
      if (res.ok) {
        const j = await res.json()
        const v = j?.data?.f43
        if (typeof v === 'number' && v > 0) {
          await portfolio.updatePrice(h.id, yuanToFen(v / 100))
          priceDrafts.value[h.id] = v / 100
        }
      }
    } catch { /* ignore */ }
  }
}

async function commitPrice(id: string) {
  const v = priceDrafts.value[id]
  if (v != null && v > 0) await portfolio.updatePrice(id, yuanToFen(v))
}

const creating = ref(false)
const form = ref<{ symbol: string; name: string; market: Market; type: HoldingType; currency: Currency; avgCost: number | null; quantity: number }>({
  symbol: '', name: '', market: 'US', type: 'etf', currency: 'USD', avgCost: null, quantity: 0
})
const canSave = computed(() => !!form.value.symbol && !!form.value.name && form.value.avgCost != null && form.value.quantity > 0)

function openCreate() {
  form.value = { symbol: '', name: '', market: 'US', type: 'etf', currency: 'USD', avgCost: null, quantity: 0 }
  creating.value = true
}

async function save() {
  if (!canSave.value) return
  const currency: Currency = form.value.market === 'US' ? 'USD' : 'CNY'
  const holding = await portfolio.addHolding({
    symbol: form.value.symbol, name: form.value.name, market: form.value.market,
    currency, type: form.value.type, quantity: form.value.quantity, avgCost: form.value.avgCost!,
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
</script>
