<template>
  <AppShell>
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">智能定投 (纳指 100)</h2>

      <section v-if="dca.config" class="bg-white rounded-lg p-4 space-y-1">
        <div class="text-sm">指数: <strong>QQQ (纳斯达克 100 ETF)</strong></div>
        <div class="text-sm">最新价: {{ dca.lastClose?.toFixed(2) ?? '—' }}</div>
        <div class="text-sm">MA250: {{ dca.ma250?.toFixed(2) ?? '—' }}</div>
        <div class="text-sm">偏离: {{ dca.deviationPct?.toFixed(2) ?? '—' }}%</div>
        <div class="text-sm">档位: <strong>{{ dca.bucket?.label || '—' }}</strong></div>
        <div class="flex gap-2 mt-2">
          <button @click="sync" class="px-3 py-1.5 bg-blue-500 text-white rounded text-sm">同步行情</button>
          <button @click="openEditor" class="px-3 py-1.5 border rounded text-sm">配置</button>
        </div>
        <div v-if="dca.syncError" class="text-xs text-red-500 mt-1">同步失败: {{ dca.syncError }}, 请手填指数数据</div>
        <div v-if="dca.lastSyncAt" class="text-xs text-gray-500">最近同步: {{ dca.lastSyncAt }}</div>
      </section>

      <section v-else class="bg-white rounded-lg p-4">
        <p class="text-sm text-gray-500">尚未配置</p>
        <button @click="openEditor" class="mt-2 px-3 py-1.5 bg-blue-500 text-white rounded text-sm">开始配置</button>
      </section>

      <div v-if="dca.config" class="space-y-2">
        <DcaSuggestionCard
          v-for="w in [1,2,3,4] as const"
          :key="w"
          :week-index="w"
          :split="fenToYuan(dca.config.weeklySplits[w-1])"
          :deviation="dca.suggestions[w]?.deviation ?? 0"
          :bucket="dca.suggestions[w]?.bucket || { label: '—', side: 'flat', rate: 1 }"
          :suggested="(dca.suggestions[w]?.suggestedAmount ?? 0) / 100"
          :exceeds="dca.suggestions[w]?.exceedsSplit ?? false"
          @confirm="confirmExec(w)"
          @skip="skipExec(w)"
        />
      </div>

      <div v-if="dca.config" class="bg-white rounded-lg p-4 space-y-2">
        <h3 class="font-semibold">手动录入指数 (MA250 不足 250 天时用)</h3>
        <textarea v-model="closesText" placeholder="逗号分隔的收盘价, 至少 250 个, 升序"
          class="w-full h-24 px-2 py-1 border rounded font-mono text-xs" />
        <input v-model.number="manualLastClose" type="number" step="0.01" placeholder="最新收盘价"
          class="w-full px-2 py-1 border rounded" />
        <button @click="manualSet" class="w-full py-2 border rounded">提交</button>
      </div>

      <!-- 配置编辑 -->
      <div v-if="editingCfg" class="fixed inset-0 bg-black/40 flex items-end justify-center z-50" @click.self="editingCfg = false">
        <div class="bg-white rounded-t-2xl p-4 w-full max-w-md space-y-3">
          <h3 class="font-semibold">DCA 配置</h3>
          <div class="space-y-2">
            <label class="text-sm">每周分扣 (4 期, 总和 ≈ 月度可投)</label>
            <div class="grid grid-cols-4 gap-2">
              <div v-for="(_, i) in cfgDraft.weeklySplits" :key="i">
                <div class="text-xs text-gray-500 text-center">第 {{ i + 1 }} 周</div>
                <input v-model.number="cfgDraft.weeklySplits[i]" type="number"
                  class="w-full px-1 py-1 border rounded text-right" />
              </div>
            </div>
          </div>
          <div>
            <div class="text-sm text-gray-500">总和 ¥{{ totalSplit }}</div>
          </div>
          <div class="flex gap-2">
            <button class="flex-1 py-2 border rounded" @click="editingCfg = false">取消</button>
            <button class="flex-1 py-2 bg-blue-500 text-white rounded" @click="saveCfg">保存</button>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import AppShell from '@/components/AppShell.vue'
import DcaSuggestionCard from '@/components/DcaSuggestionCard.vue'
import { useDcaStore } from '@/stores/dca'
import { fenToYuan } from '@/lib/money'

const dca = useDcaStore()

onMounted(async () => {
  await dca.load()
})

const editingCfg = ref(false)
const cfgDraft = ref<{ weeklySplits: [number, number, number, number] }>({ weeklySplits: [0, 0, 0, 0] })

function openEditor() {
  cfgDraft.value.weeklySplits = dca.config
    ? [...dca.config.weeklySplits] as [number, number, number, number]
    : [200, 200, 200, 200]
  editingCfg.value = true
}

const totalSplit = computed(() => cfgDraft.value.weeklySplits.reduce((s, v) => s + (v || 0), 0))

async function saveCfg() {
  await dca.saveConfig({
    name: dca.config?.name ?? '纳指100定投',
    symbol: 'QQQ.US',
    monthlyBudget: dca.config?.monthlyBudget ?? Math.round(totalSplit.value * 100),
    deviationAlertPercent: dca.config?.deviationAlertPercent ?? 5,
    weeklySplits: cfgDraft.value.weeklySplits
  })
  editingCfg.value = false
}

async function sync() {
  await dca.syncIndex('QQQ.US')
}

const closesText = ref('')
const manualLastClose = ref<number | null>(null)
function manualSet() {
  const closes = closesText.value
    .split(/[,\s]+/)
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n))
  if (closes.length < 250 || !manualLastClose.value) {
    alert('需要至少 250 个收盘价 + 最新价')
    return
  }
  dca.manualSetIndex(closes, manualLastClose.value)
}

async function confirmExec(w: 1 | 2 | 3 | 4) {
  const sug = dca.suggestions[w]
  if (!sug) return
  await dca.recordExecution(w, sug.suggestedAmount)
  alert(`已记录第 ${w} 周执行 ¥${(sug.suggestedAmount / 100).toFixed(2)}`)
}

async function skipExec(w: 1 | 2 | 3 | 4) {
  await dca.recordExecution(w, 0)
}
</script>
