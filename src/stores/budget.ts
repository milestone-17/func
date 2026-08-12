import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { budgetRepo } from '@/repos/budgetRepo'
import type { BudgetPlan, BudgetAllocation } from '@/types/budget'

export const useBudgetStore = defineStore('budget', () => {
  const currentMonth = ref(currentMonthStr())
  const plan = ref<BudgetPlan | null>(null)
  const history = ref<BudgetPlan[]>([])

  function currentMonthStr(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  async function load() {
    plan.value = (await budgetRepo.getForMonth(currentMonth.value)) || null
    history.value = await budgetRepo.list()
  }

  async function upsertPlan(allocations: BudgetAllocation[]) {
    const weeklySplits = budgetRepo.computeWeeklySplits({ allocations })
    const remaining = allocations
      .filter(a => a.type === 'savings' || a.type === 'investment')
      .reduce((s, a) => s + a.amountFen, 0)
    plan.value = await budgetRepo.upsert({
      month: currentMonth.value,
      totalIncome: 0,
      allocations,
      weeklySplits,
      remainingForDCA: remaining
    })
    history.value = await budgetRepo.list()
  }

  const totalAllocated = computed(() => {
    if (!plan.value) return 0
    return plan.value.allocations.reduce((s, a) => s + a.amountFen, 0)
  })

  return { currentMonth, plan, history, load, upsertPlan, totalAllocated }
})
