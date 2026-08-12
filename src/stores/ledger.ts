import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { transactionRepo, type TxFilter } from '@/repos/transactionRepo'
import { categoryRepo } from '@/repos/categoryRepo'
import type { Transaction, Category } from '@/types/ledger'

export const useLedgerStore = defineStore('ledger', () => {
  const transactions = ref<Transaction[]>([])
  const categories = ref<Category[]>([])
  const loaded = ref(false)

  async function refresh() {
    transactions.value = await transactionRepo.list()
    loaded.value = true
  }

  async function refreshCategories() {
    await categoryRepo.seedIfEmpty()
    categories.value = await categoryRepo.list()
  }

  async function addTx(input: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
    await transactionRepo.add(input)
    await refresh()
  }

  async function deleteTx(id: string) {
    await transactionRepo.softDelete(id)
    await refresh()
  }

  async function filterTx(f: TxFilter) {
    return transactionRepo.list(f)
  }

  const monthStats = computed(() => {
    const map = new Map<string, { income: number; expense: number }>()
    for (const t of transactions.value) {
      const month = t.date.slice(0, 7)
      const e = map.get(month) || { income: 0, expense: 0 }
      if (t.type === 'income') e.income += t.amount
      else e.expense += t.amount
      map.set(month, e)
    }
    return map
  })

  return { transactions, categories, loaded, refresh, refreshCategories, addTx, deleteTx, filterTx, monthStats }
})
