<template>
  <AppShell>
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold tracking-tight">账本</h2>
          <p class="text-xs text-ink3">{{ filtered.length }} 笔记录</p>
        </div>
        <button @click="openCreate()" class="btn-primary">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          记一笔
        </button>
      </div>

      <!-- 本月汇总 -->
      <div v-if="monthSummary" class="card card-pad flex items-center justify-around divide-x divide-line">
        <div class="text-center">
          <div class="text-[11px] text-ink3">收入</div>
          <div class="money text-base font-bold text-pos">+¥{{ formatYuan(monthSummary.income) }}</div>
        </div>
        <div class="text-center pl-4">
          <div class="text-[11px] text-ink3">支出</div>
          <div class="money text-base font-bold text-neg">-¥{{ formatYuan(monthSummary.expense) }}</div>
        </div>
        <div class="text-center pl-4">
          <div class="text-[11px] text-ink3">结余</div>
          <div class="money text-base font-bold">{{ netStr }}</div>
        </div>
      </div>

      <!-- 筛选 -->
      <div class="flex items-center gap-2 overflow-x-auto pb-1">
        <select v-model="filterMonth" class="input !w-auto !py-1.5 !text-sm shrink-0">
          <option value="">全部月份</option>
          <option v-for="m in availableMonths" :key="m" :value="m">{{ m }}</option>
        </select>
        <div class="flex rounded-xl bg-surface2 p-0.5 shrink-0">
          <button v-for="opt in typeFilters" :key="opt.value" @click="filterType = opt.value"
            :class="['rounded-lg px-3 py-1 text-xs font-medium transition', filterType === opt.value ? 'bg-surface text-ink shadow-sm' : 'text-ink3']">
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- 列表 -->
      <div v-if="filtered.length === 0" class="card card-pad text-center py-12">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-ink3">
          <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
        </div>
        <p class="mt-2 text-sm text-ink3">暂无记录</p>
      </div>

      <div v-for="t in filtered" :key="t.id"
        class="card flex items-center gap-3 px-4 py-3 fade-in">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
              :style="{ backgroundColor: categoryColor(t.categoryId) }">
          <span class="text-base">{{ categoryIcon(t.categoryId) }}</span>
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-ink truncate">{{ categoryName(t.categoryId) }}</span>
          </div>
          <div class="flex items-center gap-2 text-[11px] text-ink3">
            <span>{{ t.date.slice(5) }}</span>
            <span v-if="t.note" class="truncate">· {{ t.note }}</span>
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="money font-semibold" :class="t.type === 'income' ? 'text-pos' : 'text-neg'">
            {{ t.type === 'income' ? '+' : '-' }}¥{{ formatYuan(t.amount) }}
          </div>
        </div>
        <button class="shrink-0 text-ink3 hover:text-neg transition p-1" @click="askDelete(t.id)" aria-label="删除">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>

    <ConfirmDialog v-model="confirming" title="删除记录" message="确定删除这笔记录?此操作不可撤销。" @confirm="doDelete" />

    <!-- 新增/编辑抽屉 -->
    <div v-if="editing" class="sheet" @click.self="editing = false">
      <div class="sheet-panel space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold">记一笔</h3>
          <button @click="editing = false" class="text-ink3">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- 类型切换 -->
        <div class="flex rounded-xl bg-surface2 p-1">
          <button @click="form.type = 'expense'"
            :class="['flex-1 rounded-lg py-2 text-sm font-medium transition', form.type === 'expense' ? 'bg-neg text-white shadow-sm' : 'text-ink3']">支出</button>
          <button @click="form.type = 'income'"
            :class="['flex-1 rounded-lg py-2 text-sm font-medium transition', form.type === 'income' ? 'bg-pos text-white shadow-sm' : 'text-ink3']">收入</button>
        </div>

        <AmountInput v-model="form.amount" label="金额" />

        <div>
          <label class="label">日期</label>
          <DatePicker v-model="form.date" />
        </div>

        <div>
          <label class="label">分类</label>
          <div class="flex flex-wrap gap-2">
            <button v-for="c in filteredCategories" :key="c.id" @click="form.categoryId = c.id"
              :class="['flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition',
                form.categoryId === c.id ? 'border-transparent text-white shadow-sm' : 'border-line text-ink2 bg-surface']"
              :style="form.categoryId === c.id ? { backgroundColor: c.color } : {}">
              <span>{{ c.icon || '·' }}</span>{{ c.name }}
            </button>
          </div>
        </div>

        <div>
          <label class="label">备注 (可选)</label>
          <input v-model="form.note" type="text" placeholder="写点什么…" class="input" />
        </div>

        <button @click="save" :disabled="!canSave" class="btn-primary w-full !py-3">保存</button>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import AmountInput from '@/components/AmountInput.vue'
import DatePicker from '@/components/DatePicker.vue'
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
const typeFilters = [
  { label: '全部', value: '' as const },
  { label: '支出', value: 'expense' as const },
  { label: '收入', value: 'income' as const }
]

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

const currentMonth = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})
const monthSummary = computed(() => {
  const m = filterMonth.value || currentMonth.value
  return ledger.monthStats.get(m) || null
})
const netStr = computed(() => {
  if (!monthSummary.value) return '0'
  const net = monthSummary.value.income - monthSummary.value.expense
  return formatYuan(net)
})

const editing = ref(false)
const form = ref<{ type: TxType; amount: number | null; date: string; categoryId: string; note: string }>({
  type: 'expense', amount: null, date: new Date().toISOString().slice(0, 10), categoryId: '', note: ''
})

const filteredCategories = computed(() => ledger.categories.filter(c => c.type === form.value.type || c.type === 'both'))
const canSave = computed(() => form.value.amount != null && form.value.amount > 0 && !!form.value.categoryId)

function openCreate() {
  form.value = {
    type: 'expense', amount: null, date: new Date().toISOString().slice(0, 10),
    categoryId: filteredCategories.value[0]?.id || '', note: ''
  }
  editing.value = true
}

async function save() {
  if (!canSave.value) return
  await ledger.addTx({
    type: form.value.type,
    amount: form.value.amount!,
    date: form.value.date,
    categoryId: form.value.categoryId,
    note: form.value.note
  })
  editing.value = false
}

function categoryName(id: string) { return ledger.categories.find(c => c.id === id)?.name || '未分类' }
function categoryColor(id: string) { return ledger.categories.find(c => c.id === id)?.color || '#94a3b8' }
function categoryIcon(id: string) { return ledger.categories.find(c => c.id === id)?.icon || '·' }

const confirming = ref(false)
const pendingDelete = ref<string | null>(null)
function askDelete(id: string) { pendingDelete.value = id; confirming.value = true }
async function doDelete() { if (pendingDelete.value) await ledger.deleteTx(pendingDelete.value); pendingDelete.value = null }
</script>
