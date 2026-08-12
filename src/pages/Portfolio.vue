<template>
  <AppShell>
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">投资组合</h2>
        <button @click="openCreate()" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm">+ 新增持仓</button>
      </div>

      <section class="bg-white rounded-lg p-4">
        <div class="text-sm text-gray-500">总市值</div>
        <div class="text-2xl font-semibold">¥{{ formatYuan(portfolio.totalMarketValueCNY) }}</div>
        <div class="text-xs" :class="portfolio.totalUnrealized >= 0 ? 'text-green-600' : 'text-red-600'">
          浮盈 ¥{{ formatYuan(portfolio.totalUnrealized) }} (成本 ¥{{ formatYuan(portfolio.totalCost) }})
        </div>
      </section>

      <div class="grid grid-cols-2 gap-2">
        <div v-for="h in portfolio.holdings" :key="h.id" class="bg-white rounded-lg p-3 space-y-1">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-semibold text-sm">{{ h.name }}</div>
              <div class="text-xs text-gray-500">{{ h.symbol }} · {{ h.market }}</div>
            </div>
            <button @click="askDelete(h.id)" class="text-xs text-red-400">删</button>
          </div>
          <div class="text-sm">数量 {{ h.quantity }} · 均价 ¥{{ fenToYuan(h.avgCost).toFixed(2) }}</div>
          <div class="text-sm">现价:
            <input v-model.number="priceDrafts[h.id]" @blur="commitPrice(h.id)" type="number" step="0.01"
              class="w-20 px-1 py-0.5 border rounded text-right text-sm" />
            <button @click="refreshPrice(h)" class="ml-1 text-xs text-blue-600">拉取</button>
          </div>
          <div class="text-sm" :class="(h.unrealized || 0) >= 0 ? 'text-green-600' : 'text-red-600'">
            ¥{{ formatYuan(h.unrealized || 0) }} ({{ ((h.unrealizedPct || 0)).toFixed(2) }}%)
          </div>
        </div>
      </div>

      <ConfirmDialog v-model="confirming" title="删除持仓" message="将删除该持仓及其交易记录(软删)?" @confirm="doDelete" />

      <div v-if="creating" class="fixed inset-0 bg-black/40 flex items-end justify-center z-50" @click.self="creating = false">
        <div class="bg-white rounded-t-2xl p-4 w-full max-w-md space-y-3">
          <h3 class="font-semibold">新增持仓</h3>
          <input v-model="form.symbol" type="text" placeholder="代码 (如 QQQ / 600519)" class="w-full px-3 py-2 border rounded" />
          <input v-model="form.name" type="text" placeholder="名称" class="w-full px-3 py-2 border rounded" />
          <select v-model="form.market" class="w-full px-3 py-2 border rounded">
            <option value="US">美股</option>
            <option value="CN">A股</option>
            <option value="HK">港股</option>
          </select>
          <select v-model="form.type" class="w-full px-3 py-2 border rounded">
            <option value="stock">股票</option>
            <option value="bond">债券</option>
            <option value="cash">现金</option>
            <option value="gold">黄金</option>
          </select>
          <AmountInput v-model="form.avgCost" label="均价" />
          <input v-model.number="form.quantity" type="number" step="any" placeholder="数量" class="w-full px-3 py-2 border rounded" />
          <div class="flex gap-2">
            <button class="flex-1 py-2 border rounded" @click="creating = false">取消</button>
            <button class="flex-1 py-2 bg-blue-500 text-white rounded" @click="save">保存</button>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
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

const priceDrafts = ref<Record<string, number | null>>({})

async function refreshPrice(h: any) {
  if (h.market === 'US') {
    // QQQ 示例: 简单 stooq 拉取; 失败让用户手填
    const symbol = h.symbol.toLowerCase() + '.us'
    try {
      const to = new Date().toISOString().slice(0, 10)
      const from = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)
      const { fetchStooqBars } = await import('@/lib/stooq')
      const bars = await fetchStooqBars(symbol, from, to)
      if (bars.length > 0) {
        const last = bars[bars.length - 1].close
        await portfolio.updatePrice(h.id, yuanToFen(last))
      }
    } catch (e) {
      // 静默失败, 提示手填
      priceDrafts.value[h.id] = null
    }
  } else if (h.market === 'CN') {
    // A股尝试 Eastmoney 行情 (轻量, 失败降级)
    try {
      const secid = h.symbol.startsWith('6') ? `1.${h.symbol}` : `0.${h.symbol}`
      const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43`
      const res = await fetch(url)
      if (res.ok) {
        const j = await res.json()
        const v = j?.data?.f43
        if (typeof v === 'number' && v > 0) {
          await portfolio.updatePrice(h.id, yuanToFen(v / 100))
        }
      }
    } catch { /* ignore */ }
  }
}

async function commitPrice(id: string) {
  const v = priceDrafts.value[id]
  if (v != null && v > 0) {
    await portfolio.updatePrice(id, yuanToFen(v))
    await portfolio.refresh()
  }
}

const creating = ref(false)
const form = ref<{ symbol: string; name: string; market: Market; type: HoldingType; currency: Currency; avgCost: number | null; quantity: number }>({
  symbol: '', name: '', market: 'US', type: 'stock', currency: 'USD', avgCost: null, quantity: 0
})

function openCreate() {
  form.value = { symbol: '', name: '', market: 'US', type: 'stock', currency: 'USD', avgCost: null, quantity: 0 }
  creating.value = true
}

async function save() {
  if (!form.value.symbol || !form.value.name || form.value.avgCost == null) return
  const currency: Currency = form.value.market === 'US' ? 'USD' : 'CNY'
  const holding = await portfolio.addHolding({
    symbol: form.value.symbol,
    name: form.value.name,
    market: form.value.market,
    currency,
    type: form.value.type,
    quantity: form.value.quantity,
    avgCost: form.value.avgCost,
    currentPrice: null,
    currentPriceAt: null
  })
  // 用首笔交易记录初始仓位
  await portfolio.addTxn({
    holdingId: holding.id,
    side: 'buy',
    date: new Date().toISOString().slice(0, 10),
    price: form.value.avgCost,
    quantity: form.value.quantity,
    fee: 0
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
