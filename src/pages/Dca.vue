<template>
  <AppShell>
    <div class="space-y-4">
      <!-- 标题 + 操作 -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold tracking-tight">智能定投</h2>
          <p class="text-xs text-ink3">纳斯达克 100 · 250 日均线策略</p>
        </div>
        <button v-if="dca.config" @click="sync" :disabled="syncing" class="btn-ghost">
          <svg class="h-4 w-4" :class="syncing ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>
          </svg>
          {{ syncing ? '同步中' : '刷新行情' }}
        </button>
      </div>

      <!-- 未配置引导 -->
      <section v-if="!dca.config" class="card card-pad text-center py-10">
        <div class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand">
          <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <h3 class="mt-3 font-semibold">开始你的智能定投</h3>
        <p class="mt-1 text-sm text-ink3 px-6">设置每月预算与每周分扣,系统按均线偏离自动调节投入</p>
        <button @click="openEditor" class="btn-primary mt-4">立即配置</button>
      </section>

      <template v-else>
        <!-- 行情状态 -->
        <section class="card card-pad">
          <div class="flex items-end justify-between">
            <div>
              <div class="text-xs text-ink3">最新收盘</div>
              <div class="money text-3xl font-bold tracking-tight">{{ dca.lastClose != null ? dca.lastClose.toFixed(2) : '—' }}</div>
            </div>
            <Badge :tone="devTone">
              {{ dca.deviationPct != null ? (dca.deviationPct > 0 ? '+' : '') + dca.deviationPct.toFixed(2) + '%' : '—' }}
            </Badge>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div class="rounded-xl bg-surface2 px-3 py-2">
              <div class="text-[11px] text-ink3">MA250 均线</div>
              <div class="money text-base font-semibold">{{ dca.ma250 != null ? dca.ma250.toFixed(2) : '—' }}</div>
            </div>
            <div class="rounded-xl bg-surface2 px-3 py-2">
              <div class="text-[11px] text-ink3">当前档位</div>
              <div class="text-base font-semibold" :class="sideTextClass">{{ dca.bucket?.label || '—' }}</div>
            </div>
          </div>
          <div v-if="dca.syncError" class="mt-2 text-xs text-neg">同步失败: {{ dca.syncError }}</div>
          <div v-if="dca.lastSyncAt" class="mt-1 text-[11px] text-ink3">最近同步 {{ fmtTime(dca.lastSyncAt) }}</div>
        </section>

        <!-- 价格 vs MA250 曲线 -->
        <section v-if="chartLabels.length > 1" class="card card-pad">
          <div class="flex items-center justify-between mb-1">
            <span class="section-title">价格 vs 250 日均线</span>
            <span class="text-[11px] text-ink3">近 {{ chartLabels.length }} 日</span>
          </div>
          <LineChart :labels="chartLabels" :series="chartSeries" :height="200" />
          <p v-if="dca.ma250 == null" class="mt-2 text-[11px] text-warn">⚠ 数据不足 250 个交易日,均线尚未形成。请同步更多历史或手动录入。</p>
        </section>

        <!-- 偏离档位表 -->
        <section class="card card-pad">
          <span class="section-title mb-2">偏离档位表</span>
          <div class="overflow-hidden rounded-xl border border-line">
            <table class="w-full text-xs">
              <thead>
                <tr class="bg-surface2 text-ink3">
                  <th class="px-2.5 py-1.5 text-left font-medium">偏离区间</th>
                  <th class="px-2.5 py-1.5 text-right font-medium">投入系数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in tiers" :key="t.label"
                    :class="['border-t border-line', isCurrent(t) ? 'bg-brand-soft/60' : '']">
                  <td class="px-2.5 py-1.5">
                    <span class="inline-flex items-center gap-1.5">
                      <span class="h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: tierColor(t.side) }" />
                      <span :class="isCurrent(t) ? 'font-semibold text-ink' : 'text-ink2'">{{ t.label }}</span>
                      <span v-if="isCurrent(t)" class="text-[10px] text-brand font-semibold">当前</span>
                    </span>
                  </td>
                  <td class="px-2.5 py-1.5 text-right money font-semibold" :class="t.rate >= 1 ? 'text-pos' : 'text-neg'">×{{ t.rate.toFixed(1) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 4 周建议 -->
        <section>
          <div class="flex items-center justify-between px-1 mb-2">
            <span class="section-title">本月 4 周建议</span>
            <button @click="openEditor" class="text-xs text-brand font-medium">编辑分扣</button>
          </div>
          <div class="space-y-2.5">
            <DcaSuggestionCard
              v-for="w in [1,2,3,4] as const"
              :key="w"
              :week-index="w"
              :split="fenToYuan(dca.config.weeklySplits[w-1])"
              :deviation="dca.suggestions[w]?.deviation ?? dca.deviationPct ?? 0"
              :bucket="dca.suggestions[w]?.bucket || dca.bucket || { label: '—', side: 'flat', rate: 1 }"
              :suggested="(dca.suggestions[w]?.suggestedAmount ?? dca.config.weeklySplits[w-1]) / 100"
              :exceeds="dca.suggestions[w]?.exceedsSplit ?? false"
              @confirm="confirmExec(w)"
              @skip="skipExec(w)"
            />
          </div>
        </section>

        <!-- 手动录入 (折叠) -->
        <section class="card card-pad">
          <button class="flex w-full items-center justify-between" @click="showManual = !showManual">
            <span class="section-title">手动录入指数数据</span>
            <svg class="h-4 w-4 text-ink3 transition-transform" :class="showManual ? 'rotate-180' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div v-if="showManual" class="mt-3 space-y-2">
            <textarea v-model="closesText" placeholder="粘贴收盘价, 逗号或空格分隔, 升序, 至少 250 个"
              class="input h-20 font-mono text-[11px] resize-none" />
            <input v-model.number="manualLastClose" type="number" step="0.01" placeholder="最新收盘价" class="input" />
            <button @click="manualSet" class="btn-ghost w-full">提交</button>
          </div>
        </section>
      </template>

      <!-- 配置抽屉 -->
      <div v-if="editingCfg" class="sheet" @click.self="editingCfg = false">
        <div class="sheet-panel space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">定投配置</h3>
            <button @click="editingCfg = false" class="text-ink3">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div>
            <label class="label">每月总预算 (元)</label>
            <input v-model.number="monthlyYuan" type="number" step="0.01" placeholder="0.00" class="input money" />
          </div>
          <div>
            <label class="label">每周分扣 (元) · 当前合计 ¥{{ totalSplit.toFixed(2) }}</label>
            <div class="grid grid-cols-4 gap-2">
              <div v-for="(_, i) in cfgDraft.weeklySplits" :key="i">
                <div class="text-[11px] text-ink3 text-center mb-1">第 {{ i + 1 }} 周</div>
                <input v-model.number="cfgDraft.weeklySplits[i]" type="number" step="0.01"
                  class="input !px-1 !py-1.5 !text-sm !text-right money" />
              </div>
            </div>
            <div class="mt-2 flex gap-2">
              <button class="btn-ghost !py-1 !text-xs flex-1" @click="autoSplit">均分</button>
            </div>
          </div>
          <div class="flex gap-2 pt-1">
            <button class="btn-ghost flex-1" @click="editingCfg = false">取消</button>
            <button class="btn-primary flex-1" @click="saveCfg">保存</button>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import AppShell from '@/components/AppShell.vue'
import Badge from '@/components/Badge.vue'
import LineChart from '@/components/LineChart.vue'
import DcaSuggestionCard from '@/components/DcaSuggestionCard.vue'
import { useDcaStore } from '@/stores/dca'
import { fenToYuan, yuanToFen } from '@/lib/money'
import { rollingMA } from '@/lib/ma'

const dca = useDcaStore()

onMounted(async () => { await dca.load() })

const syncing = ref(false)
async function sync() {
  syncing.value = true
  const r = await dca.syncIndex('QQQ.US')
  syncing.value = false
  if (!r.ok && r.error) alert('同步失败: ' + r.error)
}

// ---- 价格 vs MA250 曲线 ----
const MA_PERIOD = 250
const SHOW_DAYS = 160
const chartLabels = computed(() => {
  const s = dca.series
  if (s.length === 0) return []
  const start = Math.max(0, s.length - SHOW_DAYS)
  return s.slice(start).map(d => d.date.slice(5)) // MM-DD
})
const chartSeries = computed(() => {
  const s = dca.series
  if (s.length === 0) return []
  const closes = s.map(d => d.close)
  const ma = rollingMA(closes, MA_PERIOD)
  const start = Math.max(0, s.length - SHOW_DAYS)
  return [
    { label: '收盘价', data: closes.slice(start), color: '#10b981', fill: true },
    { label: 'MA250', data: ma.slice(start), color: '#f59e0b' }
  ]
})

// ---- 偏离档位表 ----
const tiers = [
  { label: '高位 100%以上', rate: 0, side: 'high' as const },
  { label: '高位 50-100%', rate: 0.1, side: 'high' as const },
  { label: '高位 15-50%', rate: 0.4, side: 'high' as const },
  { label: '高位 0-15%', rate: 0.7, side: 'high' as const },
  { label: '基准 0%', rate: 1.0, side: 'flat' as const },
  { label: '低位 0-5%', rate: 1.3, side: 'low' as const },
  { label: '低位 5-10%', rate: 1.6, side: 'low' as const },
  { label: '低位 10-20%', rate: 1.9, side: 'low' as const },
  { label: '低位 20-30%', rate: 2.2, side: 'low' as const },
  { label: '低位 30-40%', rate: 2.5, side: 'low' as const },
  { label: '低位 40%以上', rate: 2.8, side: 'low' as const }
]
function isCurrent(t: { rate: number; label: string }) {
  return dca.bucket != null && dca.bucket.label === t.label
}
function tierColor(side: 'high' | 'low' | 'flat') {
  return side === 'high' ? 'rgb(var(--neg))' : side === 'low' ? 'rgb(var(--pos))' : 'rgb(var(--ink3))'
}

// ---- 状态色 ----
const devTone = computed<'green' | 'red' | 'blue'>(() => {
  if (dca.bucket?.side === 'high') return 'red'
  if (dca.bucket?.side === 'low') return 'green'
  return 'blue'
})
const sideTextClass = computed(() => {
  if (dca.bucket?.side === 'high') return 'text-neg'
  if (dca.bucket?.side === 'low') return 'text-pos'
  return 'text-ink'
})

// ---- 配置抽屉 ----
const editingCfg = ref(false)
const cfgDraft = ref<{ weeklySplits: [number, number, number, number] }>({ weeklySplits: [0, 0, 0, 0] })
const monthlyYuan = ref<number | null>(null)

function openEditor() {
  cfgDraft.value.weeklySplits = dca.config
    ? [...dca.config.weeklySplits].map(f => fenToYuan(f)) as [number, number, number, number]
    : [200, 200, 200, 200]
  monthlyYuan.value = dca.config ? fenToYuan(dca.config.monthlyBudget) : null
  editingCfg.value = true
}

const totalSplit = computed(() => cfgDraft.value.weeklySplits.reduce((s, v) => s + (Number(v) || 0), 0))

function autoSplit() {
  const total = monthlyYuan.value ?? totalSplit.value
  if (total > 0) {
    const q = Math.round(total / 4 * 100) / 100
    cfgDraft.value.weeklySplits = [q, q, q, +(total - q * 3).toFixed(2)] as [number, number, number, number]
  }
}

async function saveCfg() {
  await dca.saveConfig({
    name: dca.config?.name ?? '纳指100定投',
    symbol: 'QQQ.US',
    monthlyBudget: yuanToFen(monthlyYuan.value ?? totalSplit.value),
    deviationAlertPercent: dca.config?.deviationAlertPercent ?? 5,
    weeklySplits: cfgDraft.value.weeklySplits.map(y => yuanToFen(y)) as [number, number, number, number]
  })
  editingCfg.value = false
}

// ---- 手动录入 ----
const showManual = ref(false)
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
  showManual.value = false
}

async function confirmExec(w: 1 | 2 | 3 | 4) {
  const sug = dca.suggestions[w]
  if (!sug) return
  await dca.recordExecution(w, sug.suggestedAmount)
  alert(`已记录第 ${w} 周执行 ¥${(sug.suggestedAmount / 100).toFixed(2)}`)
}
async function skipExec(w: 1 | 2 | 3 | 4) { await dca.recordExecution(w, 0) }

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}
</script>
