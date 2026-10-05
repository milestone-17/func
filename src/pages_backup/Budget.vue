<template>
  <AppShell>
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold tracking-tight">预算分配</h2>
          <p class="text-xs text-ink3">{{ budget.currentMonth }}</p>
        </div>
      </div>

      <!-- 总览 -->
      <section class="card card-pad bg-gradient-to-br from-indigo-500 to-indigo-700 text-white border-0">
        <div class="text-xs font-medium text-white/80">本月总分配</div>
        <div class="money mt-1 text-3xl font-bold tracking-tight">¥{{ formatYuan(budget.totalAllocated) }}</div>
        <!-- 分类占比条 -->
        <div v-if="allocByType.length" class="mt-3 flex h-2 overflow-hidden rounded-full bg-white/20">
          <div v-for="a in allocByType" :key="a.type"
               :style="{ width: a.pct + '%', backgroundColor: TYPE_COLOR[a.type] }" />
        </div>
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/90">
          <span v-for="a in allocByType" :key="a.type" class="inline-flex items-center gap-1">
            <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: TYPE_COLOR[a.type] }" />{{ TYPE_LABEL[a.type] }} {{ a.pct }}%
          </span>
        </div>
      </section>

      <!-- 分配项 -->
      <section class="card card-pad space-y-2">
        <span class="section-title mb-1">分配明细</span>
        <div v-for="(a, idx) in form.allocations" :key="idx"
          class="flex items-center gap-2 rounded-xl bg-surface2/60 p-2">
          <select v-model="a.type" class="input !w-auto !py-1.5 !text-xs shrink-0">
            <option value="savings">储蓄</option>
            <option value="investment">投资</option>
            <option value="fixed">固定</option>
            <option value="discretionary">灵活</option>
          </select>
          <input v-model="a.label" type="text" placeholder="名称" class="input !py-1.5 !text-sm flex-1 min-w-0" />
          <div class="flex items-center rounded-lg border border-line bg-surface px-2 shrink-0">
            <span class="text-ink3 text-sm">¥</span>
            <input v-model.number="a.amountYuan" type="number" step="0.01" placeholder="0"
              class="money w-20 min-w-0 bg-transparent py-1.5 text-right text-sm text-ink focus:outline-none" />
          </div>
          <button @click="removeAlloc(idx)" class="text-ink3 hover:text-neg p-1 shrink-0" aria-label="移除">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <button @click="addAlloc" class="w-full rounded-xl border-2 border-dashed border-line py-2.5 text-sm text-ink3 transition hover:border-brand/40 hover:text-brand">
          + 添加分类
        </button>
      </section>

      <div class="flex gap-2">
        <button @click="save" class="btn-primary flex-1 !py-3">保存</button>
        <button @click="reset" class="btn-ghost !px-5">重置</button>
      </div>

      <!-- DCA 周分扣 -->
      <section v-if="budget.plan" class="card card-pad">
        <div class="flex items-center justify-between mb-3">
          <span class="section-title">智能定投 · 周分扣</span>
          <RouterLink to="/dca" class="text-[11px] text-brand font-medium">调整 →</RouterLink>
        </div>
        <div class="grid grid-cols-4 gap-2 text-center">
          <div v-for="(s, i) in budget.plan.weeklySplits" :key="i" class="rounded-xl bg-surface2 py-2.5">
            <div class="text-[11px] text-ink3">第 {{ i + 1 }} 周</div>
            <div class="money mt-0.5 text-sm font-bold text-brand">¥{{ formatYuan(s) }}</div>
          </div>
        </div>
      </section>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import { useBudgetStore } from '@/stores/budget'
import { formatYuan, fenToYuan, yuanToFen } from '@/lib/money'
import type { BudgetAllocation, AllocationType } from '@/types/budget'

const budget = useBudgetStore()

const TYPE_LABEL: Record<AllocationType, string> = {
  savings: '储蓄', investment: '投资', fixed: '固定支出', discretionary: '灵活支出'
}
const TYPE_COLOR: Record<AllocationType, string> = {
  savings: '#10b981', investment: '#6366f1', fixed: '#f59e0b', discretionary: '#fb7185'
}

interface AllocRow { type: AllocationType; label: string; amountYuan: number | null }
const form = ref<{ allocations: AllocRow[] }>({ allocations: [] })

onMounted(async () => { await budget.load(); syncForm() })
watch(() => budget.plan, syncForm)

function syncForm() {
  form.value.allocations = (budget.plan?.allocations || []).map(a => ({
    type: a.type, label: a.label, amountYuan: a.amountFen != null ? fenToYuan(a.amountFen) : null
  }))
  if (form.value.allocations.length === 0) {
    form.value.allocations = [
      { type: 'savings', label: '应急金', amountYuan: null },
      { type: 'investment', label: '智能定投', amountYuan: null },
      { type: 'fixed', label: '房租水电', amountYuan: null },
      { type: 'discretionary', label: '生活开支', amountYuan: null }
    ]
  }
}

const allocByType = computed(() => {
  const map = new Map<AllocationType, number>()
  for (const a of form.value.allocations) {
    const v = a.amountYuan ? yuanToFen(a.amountYuan) : 0
    map.set(a.type, (map.get(a.type) || 0) + v)
  }
  const total = Array.from(map.values()).reduce((s, v) => s + v, 0)
  return Array.from(map.entries())
    .filter(([, v]) => v > 0)
    .map(([type, v]) => ({ type, pct: total > 0 ? Math.round((v / total) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct)
})

function addAlloc() { form.value.allocations.push({ type: 'discretionary', label: '', amountYuan: null }) }
function removeAlloc(i: number) { form.value.allocations.splice(i, 1) }

async function save() {
  const allocs: BudgetAllocation[] = form.value.allocations
    .filter(a => a.amountYuan != null && a.amountYuan > 0)
    .map(a => ({ type: a.type, label: a.label, amountFen: yuanToFen(a.amountYuan!) }))
  await budget.upsertPlan(allocs)
}

function reset() { syncForm() }
</script>
