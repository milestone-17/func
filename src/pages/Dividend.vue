<template>
  <AppShell>
    <div class="space-y-4">
      <header class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <h1 class="text-xl font-bold tracking-tight">红利分数</h1>
          <p class="text-xs text-ink3 mt-0.5">
            个股因子 80% + 市场环境 20% · 更新 {{ snap?.date ?? '—' }} {{ snap?.generatedAt ? snap.generatedAt.slice(11, 16) : '' }}
          </p>
        </div>
        <button @click="load" :disabled="loading" class="btn-ghost shrink-0">
          <svg class="h-4 w-4" :class="loading ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
          <span class="hidden sm:inline">{{ loading ? '计算中' : '刷新' }}</span>
        </button>
      </header>

      <!-- 加载/失败态 -->
      <div v-if="loading && !snap" class="card card-pad text-center py-12">
        <p class="text-sm text-ink3">正在计算红利分数…（首次可能需要数分钟）</p>
      </div>
      <div v-else-if="error && !snap" class="card card-pad text-center py-12">
        <p class="text-sm" :class="error.includes('恢复') ? 'text-ink3' : 'text-neg'">{{ error }}</p>
        <button @click="load" class="btn-ghost mt-3">重试</button>
      </div>
      <div v-else-if="!snap" class="card card-pad text-center py-12">
        <p class="text-sm text-ink3">暂无数据，等待首次计算</p>
      </div>

      <template v-else>
        <!-- 市场环境分 -->
        <div class="card card-pad">
          <div class="flex items-start justify-between">
            <div>
              <p class="text-xs text-ink3">市场环境分（全市场共用）</p>
              <p class="text-3xl font-bold mt-1">{{ fmtNum(snap.market?.marketScore) }}</p>
            </div>
            <span :class="['rounded-full px-3 py-1 text-xs font-medium', tierCls]">{{ snap.market?.tierLabel ?? tierFallback }}</span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <div class="flex justify-between">
              <span class="text-ink3">股债利差 5 年分位（权重 60）</span>
              <span class="money">{{ pct(snap.market?.spreadPctile, 0) }} → {{ fmtNum(snap.market?.spreadScore) }} 分</span>
            </div>
            <div class="flex justify-between">
              <span class="text-ink3">MA250 信号（权重 40）</span>
              <span class="money">{{ maSignalText }} → {{ fmtNum(snap.market?.ma250SignalScore) }} 分</span>
            </div>
            <div class="flex justify-between">
              <span class="text-ink3">中证红利收盘</span>
              <span class="money">{{ fmtNum(snap.market?.indexClose, 2) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-ink3">MA250</span>
              <span class="money">{{ fmtNum(snap.market?.ma250, 2) }}</span>
            </div>
          </div>
          <p class="mt-2 text-[10px] text-ink3">口径：利差 = 指数股息率 − 10Y 国债收益率，取 5 年滚动分位；MA250 组合信号 = 利差分位≥0.6 或收盘站上 MA250 → 满仓信号。三档：≥60 适合投入 / 40~60 中性 / &lt;40 偏贵观望。15 年回测验证（详见下方口径说明）。</p>
        </div>

        <!-- 样本说明 -->
        <p class="text-xs text-ink3 px-1">
          样本池 {{ snap.sampleCount ?? '—' }} 只（中证红利门槛初筛后按股息率取前 100）· 剔除数据不足 {{ snap.skippedCount ?? '—' }} 只
          <template v-if="snap.notes?.length">· {{ snap.notes.join('；') }}</template>
        </p>

        <!-- 榜单 -->
        <div class="card">
          <div class="px-4 pt-3 pb-2 flex items-center justify-between">
            <h2 class="text-sm font-semibold">个股排行榜</h2>
            <button v-if="(snap.stocks?.length ?? 0) > expandN" @click="expanded = !expanded" class="text-xs text-brand hover:underline">
              {{ expanded ? '收起' : `展开全部 ${snap.stocks?.length ?? 0} 只` }}
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-left text-ink3 border-b border-line">
                  <th class="px-4 py-2 font-medium">排名</th>
                  <th class="px-2 py-2 font-medium">代码</th>
                  <th class="px-2 py-2 font-medium">名称</th>
                  <th class="px-2 py-2 font-medium text-right">总分</th>
                  <th class="px-2 py-2 font-medium text-right">个股因子</th>
                  <th class="px-2 py-2 font-medium text-right">股息率</th>
                  <th class="px-2 py-2 font-medium text-right hidden sm:table-cell">连续分红</th>
                  <th class="px-2 py-2 font-medium text-right hidden md:table-cell">派息率</th>
                  <th class="px-2 py-2 font-medium text-right hidden md:table-cell">ROE</th>
                  <th class="px-2 py-2 font-medium text-right hidden lg:table-cell">年化波动</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in shown" :key="s.code" @click="toggle(s.code)"
                    :class="['cursor-pointer border-b border-line/50 hover:bg-surface2/60', open === s.code ? 'bg-surface2/60' : '']">
                  <td class="px-4 py-2 font-mono">{{ s.rank }}</td>
                  <td class="px-2 py-2 font-mono">{{ s.code }}</td>
                  <td class="px-2 py-2">{{ s.name }}</td>
                  <td class="px-2 py-2 text-right font-bold">{{ fmtNum(s.totalScore, 1) }}</td>
                  <td class="px-2 py-2 text-right">{{ fmtNum(s.stockScore, 1) }}</td>
                  <td class="px-2 py-2 text-right money">{{ pct(s.yieldPct, 2) }}</td>
                  <td class="px-2 py-2 text-right hidden sm:table-cell">{{ s.consecutiveYears ?? '—' }} 年</td>
                  <td class="px-2 py-2 text-right hidden md:table-cell">{{ pct(s.payoutRatio != null ? s.payoutRatio * 100 : null, 0) }}</td>
                  <td class="px-2 py-2 text-right hidden md:table-cell">{{ pct(s.roe, 2) }}</td>
                  <td class="px-2 py-2 text-right hidden lg:table-cell">{{ pct(s.volAnnualPct, 1) }}</td>
                </tr>
                <tr v-if="(snap.stocks?.length ?? 0) === 0">
                  <td colspan="10" class="px-4 py-8 text-center text-ink3">暂无数据</td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- 五因子明细（点击行展开） -->
          <div v-if="openRow" class="px-4 py-3 border-t border-line bg-surface2/40">
            <p class="text-xs text-ink3 mb-2">{{ openRow.name }}（{{ openRow.code }}）五因子明细</p>
            <div class="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
              <div v-for="f in factorBars" :key="f.label" class="text-xs">
                <div class="flex justify-between mb-0.5">
                  <span class="text-ink3">{{ f.label }}</span>
                  <span class="money">{{ fmtNum(f.val, 1) }} / {{ f.max }}</span>
                </div>
                <div class="h-1.5 rounded bg-surface2 overflow-hidden">
                  <div class="h-full rounded bg-brand" :style="{ width: f.pct + '%' }"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 口径说明 -->
        <details class="card card-pad text-xs text-ink2">
          <summary class="cursor-pointer font-medium text-ink">评分口径与回测说明</summary>
          <div class="mt-2 space-y-2 leading-relaxed">
            <p><b>总分</b> = 个股因子 × 80% + 市场环境 × 20%（市场环境为全市场共用分）。</p>
            <p><b>个股五因子</b>（借鉴中证红利、标普中国A股红利机会、中证红利低波、中证全指红利质量、MSCI HDY 与 Morningstar 派息率研究）：股息率分位 30 · 分红连续性 25 · 派息率健康 20（10%~70% 满分，70%~100% 线性递减，&gt;100% 或 &lt;10% 低分）· 盈利质量 15 · 低波动 10。</p>
            <p><b>市场环境</b> = 股债利差 5 年分位 × 60% + MA250 组合信号 × 40%。</p>
            <p><b>15 年回测</b>（2011-04~2026-10，中证红利价格指数口径，不含股息约低估 2~2.5pp/年）：组合策略总收益 +99% vs 买入持有 +72%，年化 4.70% vs 3.69%，夏普 0.13 vs 0.08，最大回撤相同 46.5%。单一 MA250 趋势被证伪（-19%），仅作辅助因子；纯利差择时亦略输基准。超额收益集中于 2018 年熊市防御（15 年仅 7 个月空仓），本质是低频风险提示，不是频繁买卖信号。</p>
            <p><b>局限性</b>：股息率与国债利差属 Fed Model 式名义量比较，仅用 5 年分位数做相对比较规避绝对阈值缺陷；均线单用存在震荡市鞭打效应；历史回测不代表未来。</p>
            <p><b>样本池</b>：市值/成交额前 80% + 连续 3 年现金分红初筛，按股息率取前 100；上市不足 3 年或数据缺失不入池。</p>
            <p><b>数据来源</b>：东方财富公开接口（日K/分红明细/10Y 国债收益率）。本页仅为量化参考，不构成投资建议。</p>
          </div>
        </details>
      </template>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import { api } from '@/lib/api'

interface StockRow {
  code: string; name: string; price?: number; rank?: number
  totalScore?: number; stockScore?: number; yieldPct?: number
  consecutiveYears?: number; payoutRatio?: number; roe?: number; volAnnualPct?: number
  factors?: { yieldScore?: number; continuityScore?: number; payoutScore?: number; qualityScore?: number; lowVolScore?: number }
}
interface MarketEnv {
  spreadPctile?: number; spreadScore?: number; ma250Signal?: boolean; ma250SignalScore?: number
  marketScore?: number; tier?: string; tierLabel?: string; indexClose?: number; ma250?: number
}
interface Snapshot {
  date?: string; generatedAt?: string; sampleCount?: number; skippedCount?: number
  market?: MarketEnv; stocks?: StockRow[]; notes?: string[]
}

const snap = ref<Snapshot | null>(null)
const loading = ref(false)
const error = ref('')
const expanded = ref(false)
const open = ref<string | null>(null)
const expandN = 20

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const r = await api.get<{ code: number; data: Snapshot }>('/api/dividend/score')
    snap.value = r.data
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const shown = computed<StockRow[]>(() => {
  const list = snap.value?.stocks ?? []
  return expanded.value ? list : list.slice(0, expandN)
})
const openRow = computed<StockRow | null>(() => snap.value?.stocks?.find(s => s.code === open.value) ?? null)

const tierCls = computed(() => {
  const t = snap.value?.market?.tier
  if (t === 'high') return 'bg-pos/15 text-pos'
  if (t === 'low') return 'bg-neg/15 text-neg'
  return 'bg-warn/15 text-warn'
})
const tierFallback = computed(() => {
  const v = snap.value?.market?.marketScore
  if (v == null) return '—'
  return v >= 60 ? '适合投入' : v >= 40 ? '中性' : '偏贵观望'
})
const maSignalText = computed(() => snap.value?.market?.ma250Signal == null ? '—' : (snap.value.market!.ma250Signal ? '站上 MA250' : '跌破 MA250'))

const factorBars = computed(() => {
  const f = openRow.value?.factors
  if (!f) return []
  return [
    { label: '股息率分位', val: f.yieldScore, max: 30 },
    { label: '分红连续性', val: f.continuityScore, max: 25 },
    { label: '派息率健康', val: f.payoutScore, max: 20 },
    { label: '盈利质量', val: f.qualityScore, max: 15 },
    { label: '低波动', val: f.lowVolScore, max: 10 }
  ].map(x => ({ ...x, pct: x.val == null ? 0 : Math.min(100, (x.val / x.max) * 100) }))
})

function toggle(code: string): void {
  open.value = open.value === code ? null : code
}
function fmtNum(v: number | null | undefined, digits = 0): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits)
}
function pct(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`
}
</script>
