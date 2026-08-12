<template>
  <AppShell>
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">账本</h2>
        <button @click="openCreate()" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm">+ 新增</button>
      </div>

      <div class="bg-white rounded-lg p-3 flex items-center gap-2">
        <select v-model="filterMonth" class="px-2 py-1 border rounded text-sm">
          <option value="">全部</option>
          <option v-for="m in availableMonths" :key="m" :value="m">{{ m }}</option>
        </select>
        <select v-model="filterType" class="px-2 py-1 border rounded text-sm">
          <option value="">全部</option>
          <option value="income">收入</option>
          <option value="expense">支出</option>
        </select>
      </div>

      <div v-if="filtered.length === 0" class="text-center text-gray-500 py-8">暂无记录</div>

      <div v-for="t in filtered" :key="t.id" class="bg-white rounded-lg p-3 flex items-center justify-between">
        <div>
          <div class="text-sm">
            <CategoryChip :name="categoryName(t.categoryId)" :color="categoryColor(t.categoryId)" />
            <span class="ml-2 text-gray-500 text-xs">{{ t.date }}</span>
          </div>
          <div v-if="t.note" class="text-xs text-gray-500 mt-0.5">{{ t.note }}</div>
        </div>
        <div class="flex items-center gap-2">
          <span :class="t.type === 'income' ? 'text-green-600' : 'text-red-600'" class="font-semibold">
            {{ t.type === 'income' ? '+' : '-' }}¥{{ formatYuan(t.amount) }}
          </span>
          <button class="text-gray-400 text-sm" @click="askDelete(t.id)">删</button>
        </div>
      </div>
    </div>

    <ConfirmDialog v-model="confirming" title="删除确认" message="确定要删除该条记录吗？" @confirm="doDelete" />

    <!-- 编辑模态框 -->
    <div v-if="editing" class="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50" @click.self="editing = false">
      <div class="bg-white rounded-t-2xl sm:rounded-lg p-4 w-full max-w-md space-y-3">
        <h3 class="font-semibold">新增交易</h3>
        <div class="flex gap-2">
          <button :class="['flex-1 py-2 rounded', form.type === 'expense' ? 'bg-red-500 text-white' : 'border']" @click="form.type = 'expense'">支出</button>
          <button :class="['flex-1 py-2 rounded', form.type === 'income' ? 'bg-green-500 text-white' : 'border']" @click="form.type = 'income'">收入</button>
        </div>
        <AmountInput v-model="form.amount" label="金额" />
        <DatePicker v-model="form.date" />
        <select v-model="form.categoryId" class="w-full px-3 py-2 border rounded">
          <option v-for="c in filteredCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <input v-model="form.note" type="text" placeholder="备注 (可选)" class="w-full px-3 py-2 border rounded" />
        <div class="flex gap-2">
          <button class="flex-1 py-2 border rounded" @click="editing = false">取消</button>
          <button class="flex-1 py-2 bg-blue-500 text-white rounded" @click="save">保存</button>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import AmountInput from '@/components/AmountInput.vue'
import DatePicker from '@/components/DatePicker.vue'
import CategoryChip from '@/components/CategoryChip.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useLedgerStore } from '@/stores/ledger'
import { formatYuan } from '@/lib/money'
import type { TxType } from '@/types/ledger'

const ledger = useLedgerStore()

onMounted(async () => {
  await ledger.refreshCategories()
  await ledger.refresh()
})

const filterMonth = ref('')
const filterType = ref<'' | TxType>('')

const availableMonths = computed(() => {
  const set = new Set(ledger.transactions.map(t => t.date.slice(0, 7)))
  return Array.from(set).sort().reverse()
})

const filtered = computed(() => {
  let arr = ledger.transactions
  if (filterMonth.value) arr = arr.filter(t => t.date.startsWith(filterMonth.value))
  if (filterType.value) arr = arr.filter(t => t.type === filterType.value)
  return arr
})

const editing = ref(false)
const form = ref<{ type: TxType; amount: number | null; date: string; categoryId: string; note: string }>({
  type: 'expense', amount: null, date: new Date().toISOString().slice(0, 10), categoryId: '', note: ''
})

const filteredCategories = computed(() => ledger.categories.filter(c => c.type === form.value.type))

function openCreate() {
  form.value = {
    type: 'expense', amount: null, date: new Date().toISOString().slice(0, 10),
    categoryId: filteredCategories.value[0]?.id || '', note: ''
  }
  editing.value = true
}

async function save() {
  if (form.value.amount == null || form.value.amount <= 0 || !form.value.categoryId) return
  await ledger.addTx({
    type: form.value.type,
    amount: form.value.amount,
    date: form.value.date,
    categoryId: form.value.categoryId,
    note: form.value.note
  })
  editing.value = false
}

function categoryName(id: string) { return ledger.categories.find(c => c.id === id)?.name || '—' }
function categoryColor(id: string) { return ledger.categories.find(c => c.id === id)?.color || '#94a3b8' }

const confirming = ref(false)
const pendingDelete = ref<string | null>(null)
function askDelete(id: string) { pendingDelete.value = id; confirming.value = true }
async function doDelete() { if (pendingDelete.value) await ledger.deleteTx(pendingDelete.value); pendingDelete.value = null }
</script>
