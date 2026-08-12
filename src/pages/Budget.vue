<template>
  <AppShell>
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">预算分配 · {{ budget.currentMonth }}</h2>

      <div class="bg-white rounded-lg p-4 space-y-2">
        <div class="text-sm text-gray-600">本月总分配 ¥{{ formatYuan(budget.totalAllocated) }}</div>
        <div v-for="(a, idx) in form.allocations" :key="idx" class="flex items-center gap-2">
          <select v-model="a.type" class="px-2 py-1 border rounded text-sm">
            <option value="savings">储蓄</option>
            <option value="investment">投资</option>
            <option value="fixed">固定支出</option>
            <option value="discretionary">灵活支出</option>
          </select>
          <input v-model="a.label" type="text" placeholder="名称" class="flex-1 px-2 py-1 border rounded text-sm" />
          <AmountInput v-model="a.amountFen" class="w-32" />
          <button @click="removeAlloc(idx)" class="text-red-400 px-1">×</button>
        </div>
        <button @click="addAlloc" class="w-full py-2 border-dashed border-2 rounded text-gray-500 text-sm">+ 添加分类</button>
      </div>

      <div class="flex gap-2">
        <button @click="save" class="flex-1 py-2 bg-blue-500 text-white rounded-lg">保存</button>
        <button @click="reset" class="px-4 py-2 border rounded-lg">重置</button>
      </div>

      <div v-if="budget.plan" class="bg-white rounded-lg p-4">
        <h3 class="font-semibold mb-2">智能定投 (DCA) 周分扣</h3>
        <div class="grid grid-cols-4 gap-2 text-center">
          <div v-for="(s, i) in budget.plan.weeklySplits" :key="i" class="p-2 bg-gray-50 rounded">
            <div class="text-xs text-gray-500">第 {{ i + 1 }} 周</div>
            <div class="font-semibold">¥{{ formatYuan(s) }}</div>
          </div>
        </div>
        <RouterLink to="/dca" class="text-blue-600 text-sm mt-2 inline-block">去 DCA 页面调整分扣 →</RouterLink>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import AmountInput from '@/components/AmountInput.vue'
import { useBudgetStore } from '@/stores/budget'
import { formatYuan } from '@/lib/money'
import type { BudgetAllocation } from '@/types/budget'

const budget = useBudgetStore()

interface AllocRow { type: BudgetAllocation['type']; label: string; amountFen: number | null }

const form = ref<{ allocations: AllocRow[] }>({ allocations: [] })

onMounted(async () => {
  await budget.load()
  syncForm()
})

watch(() => budget.plan, syncForm)

function syncForm() {
  form.value.allocations = (budget.plan?.allocations || []).map(a => ({
    type: a.type, label: a.label, amountFen: a.amountFen
  }))
  if (form.value.allocations.length === 0) {
    form.value.allocations = [
      { type: 'savings', label: '应急金', amountFen: 0 },
      { type: 'investment', label: '智能定投', amountFen: 0 },
      { type: 'fixed', label: '房租/水电', amountFen: 0 },
      { type: 'discretionary', label: '生活开支', amountFen: 0 }
    ]
  }
}

function addAlloc() { form.value.allocations.push({ type: 'discretionary', label: '', amountFen: 0 }) }
function removeAlloc(i: number) { form.value.allocations.splice(i, 1) }

async function save() {
  const allocs: BudgetAllocation[] = form.value.allocations
    .filter(a => a.amountFen != null)
    .map(a => ({ type: a.type, label: a.label, amountFen: a.amountFen! }))
  await budget.upsertPlan(allocs)
}

function reset() { syncForm() }
</script>
