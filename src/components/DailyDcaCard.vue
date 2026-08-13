<template>
  <section class="card card-pad space-y-3">
    <div class="flex items-center justify-between">
      <div>
        <div class="text-sm font-semibold">每日定投</div>
        <div class="text-[11px] text-ink3">打开应用即按最新价自动买入 · 浏览器关闭不执行</div>
      </div>
      <button @click="toggleEnabled" :class="cfg?.enabled ? 'btn-ghost' : 'btn-primary'">
        {{ cfg?.enabled ? '已启用 · 点击停用' : '启用' }}
      </button>
    </div>

    <div v-if="portfolio.holdings.length === 0" class="text-xs text-ink3">
      请先在「投资」页添加持仓后再配置每日定投。
    </div>
    <template v-else>
      <div>
        <label class="label">定投基金</label>
        <select v-model="holdingId" class="input">
          <option :value="null" disabled>选择持仓</option>
          <option v-for="h in portfolio.holdings" :key="h.id" :value="h.id">{{ h.name }} ({{ h.symbol }})</option>
        </select>
      </div>
      <AmountInput v-model="amountFen" label="每日金额 (元)" />
      <div class="flex items-center gap-2">
        <button @click="save" class="btn-primary flex-1 !py-2.5">保存配置</button>
        <button @click="runNow" class="btn-ghost">立即执行今日</button>
      </div>
      <div class="flex items-center justify-between text-[11px] text-ink3">
        <span>最近执行: {{ cfg?.lastExecutedDate || '尚未执行' }}</span>
        <span v-if="cfg?.enabled" class="text-pos">启用中</span>
      </div>
      <div v-if="dailyDca.lastMessage" class="text-xs text-warn">{{ dailyDca.lastMessage }}</div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import AmountInput from '@/components/AmountInput.vue'
import { useDailyDcaStore } from '@/stores/dailyDca'
import { usePortfolioStore } from '@/stores/portfolio'

const dailyDca = useDailyDcaStore()
const portfolio = usePortfolioStore()
const cfg = computed(() => dailyDca.config)

const holdingId = ref<string | null>(null)
const amountFen = ref<number | null>(null)

onMounted(async () => {
  await portfolio.refresh()
  await dailyDca.load()
  holdingId.value = cfg.value?.holdingId ?? null
  amountFen.value = cfg.value?.dailyAmountFen ?? null
})

async function toggleEnabled() {
  await dailyDca.save({ enabled: !(cfg.value?.enabled) })
}

async function save() {
  await dailyDca.save({ holdingId: holdingId.value, dailyAmountFen: amountFen.value ?? 0 })
}

async function runNow() {
  await save()
  await dailyDca.runIfPending()
  await portfolio.refresh()
}
</script>
