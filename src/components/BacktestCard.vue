<template>
  <section class="card card-pad">
    <div class="flex items-center justify-between mb-2">
      <span class="section-title">15 年策略回测{{ strategy === 'a' ? ' · 智能定投' : ' · 通道策略' }}</span>
      <span v-if="artifact" class="text-[10px] text-ink3">产物月度刷新</span>
    </div>

    <!-- 加载骨架 -->
    <div v-if="loading" class="space-y-2.5 animate-pulse">
      <div class="h-12 rounded-xl bg-surface2" />
      <div class="flex gap-1.5">
        <div v-for="i in 6" :key="i" class="h-8 w-16 rounded-lg bg-surface2" />
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div v-for="i in 8" :key="i" class="h-14 rounded-xl bg-surface2" />
      </div>
    </div>

    <!-- 产物加载失败 (组件边界内容错, 不影响页面其他功能) -->
    <div v-else-if="loadError" class="py-6 text-center">
      <p class="text-sm text-ink3">回测数据加载失败</p>
      <button class="btn-ghost mt-2 !py-1 !text-xs" @click="loadArtifact">重试</button>
    </div>

    <template v-else-if="artifact">
      <!-- TL;DR 结论行 -->
      <div v-if="tldr" class="rounded-xl bg-brand-soft/60 px-3 py-2.5 mb-3">
        <p class="text-[13px] leading-snug text-ink">{{ tldr }}</p>
        <p class="mt-1 text-[10px] text-ink3">{{ tldrSub }}</p>
      </div>

      <!-- 标的 chips -->
      <div class="flex gap-1.5 flex-wrap mb-3">
        <button v-for="t in presetChips" :key="t.secid" @click="pickPreset(t.secid)"
          :class="['rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                   !customMode && selected === t.secid ? 'bg-brand text-white' : 'bg-surface2 text-ink2 hover:text-ink']">
          {{ t.name }}
        </button>
        <button v-if="strategy === 'a'" @click="customOpen = !customOpen"
          :class="['rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                   customMode ? 'bg-brand text-white' : 'border border-dashed border-line text-ink3 hover:text-brand hover:border-brand']">
          {{ customMode && customName ? customName : '自定义' }}
        </button>
      </div>

      <!-- 自定义标的面板 -->
      <div v-if="strategy === 'a' && customOpen" class="mb-3 rounded-xl border border-line p-2.5 space-y-2">
        <div class="relative">
          <input v-model="searchKey" @input="onSearchKey" placeholder="搜索场外基金, 如 001594 / 纳斯达克" class="input !py-1.5 !text-sm" />
          <div v-if="searching" class="absolute right-3 top-2 text-ink3 text-xs">搜索中…</div>
        </div>
        <div v-if="searchResults.length > 0" class="max-h-48 overflow-y-auto divide-y divide-line rounded-xl border border-line">
          <button v-for="it in searchResults" :key="it.code" @click="pickFund(it)"
            class="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface2 transition-colors">
            <span>
              <span class="text-sm font-medium">{{ it.name }}</span>
              <span class="ml-2 text-xs text-ink3">{{ it.code }}</span>
            </span>
            <span class="text-[11px] text-ink3">{{ it.type }}</span>
          </button>
        </div>
        <p v-else-if="!searching && searchKey.trim().length >= 2" class="text-center text-xs text-ink3 py-2">无匹配结果</p>
        <details class="text-xs">
          <summary class="cursor-pointer text-ink3">高级：直接输入 secid</summary>
          <div class="mt-1.5 flex gap-1.5">
            <input v-model="advSecid" @keyup.enter="applyAdv" placeholder="如 1.000300 / 100.NDX / 001594"
              class="input !py-1.5 !text-xs flex-1 font-mono" />
            <button class="btn-ghost !py-1 !text-xs" @click="applyAdv">应用</button>
          </div>
          <p v-if="advErr" class="mt-1 text-[11px] text-neg">{{ advErr }}</p>
        </details>
        <p class="text-[10px] text-ink3">自定义标的通过服务端实时回测（新标的首拉限频 10 次/小时）</p>
      </div>

      <!-- 窗口切换 -->
      <div class="flex gap-1 mb-3">
        <button v-for="w in windowsAvail" :key="w.key" @click="windowKey = w.key"
          :class="['rounded-lg px-3 py-1 text-xs font-medium transition-colors',
                   windowKey === w.key ? 'bg-brand text-white' : 'bg-surface2 text-ink2 hover:text-ink']">
          {{ w.label }}
        </button>
      </div>

      <!-- 金额选择器 -->
      <div class="flex items-center gap-1.5 flex-wrap mb-3">
        <span class="text-xs text-ink3">{{ strategy === 'a' ? '每月投入' : '期初资金' }}</span>
        <button v-for="p in amountPresets" :key="p" @click="amount = p; customAmount = null"
          :class="['rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                   amount === p && customAmount === null ? 'bg-brand text-white' : 'bg-surface2 text-ink2 hover:text-ink']">
          {{ fmtWan(p) }}
        </button>
        <span class="inline-flex items-center gap-1">
          <input v-model.number="customAmount" @input="onCustomAmount" type="number"
            :min="strategy === 'a' ? 100 : 1000" :max="strategy === 'a' ? 100000 : 10000000" step="100"
            placeholder="自定义" class="input !w-24 !py-1 !text-xs" />
          <span class="text-[11px] text-ink3">元</span>
        </span>
      </div>

      <!-- 费率设置 -->
      <div class="flex items-center gap-1.5 flex-wrap mb-3">
        <span class="text-xs text-ink3">买入费率</span>
        <button v-for="f in feeOptions" :key="f.key" @click="feeSel = f.key"
          :class="['rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                   feeSel === f.key ? 'bg-brand text-white' : 'bg-surface2 text-ink2 hover:text-ink']">
          {{ f.label }}
        </button>
        <button @click="feeSel = 'custom'"
          :class="['rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                   feeSel === 'custom' ? 'bg-brand text-white' : 'bg-surface2 text-ink2 hover:text-ink']">
          自定义
        </button>
        <span v-if="feeSel === 'custom'" class="inline-flex items-center gap-1">
          <input v-model.number="customFeePct" type="number" min="0" max="3" step="0.01" placeholder="0.05"
            class="input !w-20 !py-1 !text-xs" />
          <span class="text-[11px] text-ink3">% (0~3)</span>
        </span>
      </div>

      <!-- API 加载态 -->
      <div v-if="apiLoading" class="flex items-center gap-2 mb-2 text-xs text-ink3">
        <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
        回测计算中…
      </div>

      <!-- API 失败态 -->
      <div v-else-if="apiError" class="mb-2 rounded-xl border border-neg/30 bg-neg/10 px-3 py-2 flex items-center justify-between">
        <span class="text-xs text-neg">回测数据加载失败<template v-if="apiErrorMsg">：{{ apiErrorMsg }}</template></span>
        <button class="text-xs text-brand font-medium" @click="retryApi">重试</button>
      </div>

      <template v-if="metrics">
        <!-- 指标网格 -->
        <div :class="['grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 transition-opacity', apiLoading ? 'opacity-50' : '']">
          <div v-for="t in metricTiles" :key="t.label" class="rounded-xl bg-surface2 px-2.5 py-2">
            <div class="text-[11px] text-ink3">{{ t.label }}</div>
            <div class="money text-sm font-semibold" :class="t.cls || 'text-ink'">{{ t.value }}</div>
          </div>
        </div>

        <!-- 美元 / QDII 提示行 -->
        <p v-if="isQdii" class="mb-2 text-[11px] text-ink3">QDII 净值已含汇率与分红，历史多次暂停申购，回测假设全程可买</p>
        <template v-else-if="currency === 'USD'">
          <p class="mb-1 text-[11px] text-ink2">
            {{ metrics.fxContributionPct != null ? `其中汇率贡献 ${metrics.fxContributionPct >= 0 ? '+' : ''}${metrics.fxContributionPct.toFixed(1)}%（已折算人民币计价）` : '业绩已按 USDCNH 折算为人民币，含汇率变动影响' }}
          </p>
          <p class="mb-2 text-[10px] text-ink3">USDCNH 为离岸价近似，实际以银行在岸牌价为准，受个人 5 万美元/年额度限制</p>
        </template>

        <!-- 策略B 三基准对比 -->
        <div v-if="strategy === 'b' && bBenchText" class="mb-3 rounded-xl bg-surface2 px-2.5 py-2 text-xs text-ink2">
          {{ bBenchText }}
        </div>

        <!-- 跑输年份行 -->
        <p v-if="losingText" class="mb-3 text-xs text-ink2">{{ losingText }}</p>

        <!-- 资金曲线迷你图 -->
        <div v-if="chartData" class="mb-3">
          <LineChart :labels="chartData.labels" :series="chartData.series" :height="200" />
          <p class="mt-1 text-[10px] text-ink3 text-right">归一化净值（首个非零点 = 1）· 默认费率档</p>
        </div>

        <!-- 可折叠逐年表 -->
        <details v-if="yearlyRows.length > 0" class="mb-3">
          <summary class="cursor-pointer text-xs font-medium text-ink2">逐年分解（{{ yearlyRows.length }} 年）</summary>
          <div class="mt-2 overflow-x-auto rounded-xl border border-line">
            <table class="w-full text-xs">
              <thead>
                <tr class="bg-surface2 text-ink3">
                  <th class="px-2.5 py-1.5 text-left font-medium">年份</th>
                  <th class="px-2.5 py-1.5 text-right font-medium">累计投入</th>
                  <th class="px-2.5 py-1.5 text-right font-medium">期末财富</th>
                  <th class="px-2.5 py-1.5 text-right font-medium">收益率</th>
                  <th v-if="hasYearlyExcess" class="px-2.5 py-1.5 text-right font-medium">当年超额</th>
                  <th v-if="hasYearlyFx" class="px-2.5 py-1.5 text-right font-medium">年末汇率</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in yearlyRows" :key="r.year" class="border-t border-line">
                  <td class="px-2.5 py-1.5 text-ink2">{{ r.year }}</td>
                  <td class="px-2.5 py-1.5 text-right money">{{ fmtMoney(r.invested * amtScale) }}</td>
                  <td class="px-2.5 py-1.5 text-right money">{{ fmtMoney(r.wealth * amtScale) }}</td>
                  <td class="px-2.5 py-1.5 text-right money font-semibold" :class="r.totalReturnPct >= 0 ? 'text-pos' : 'text-neg'">
                    {{ r.totalReturnPct >= 0 ? '+' : '' }}{{ r.totalReturnPct.toFixed(1) }}%
                  </td>
                  <td v-if="hasYearlyExcess" class="px-2.5 py-1.5 text-right money" :class="(r.excessPts ?? 0) >= 0 ? 'text-pos' : 'text-neg'">
                    {{ r.excessPts != null ? (r.excessPts >= 0 ? '+' : '') + r.excessPts.toFixed(1) + 'pp' : '—' }}
                  </td>
                  <td v-if="hasYearlyFx" class="px-2.5 py-1.5 text-right money">{{ r.fx != null ? r.fx.toFixed(4) : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>
      <p v-else-if="!apiLoading && !apiError" class="py-4 text-center text-xs text-ink3">该标的/窗口数据不足，无法回测</p>

      <!-- 口径声明组 -->
      <details class="mt-2 text-[11px] text-ink3">
        <summary class="cursor-pointer text-xs font-medium text-ink2">口径与假设</summary>
        <ul class="mt-1.5 list-disc pl-4 space-y-1">
          <li>策略投入：月预算拆 4 周，各周（1-7/8-14/15-21/22-月末）最后一个交易日按档位投入</li>
          <li>普通定投基准：每个交易日定额投入（月基准÷当月交易日数）</li>
          <li>价格指数不含成分股分红（A股与美股指数均如此），沪深300 股息约 2.2~2.75%/年，回测系统性低估真实收益</li>
          <li>场外基金用累计净值（已含分红），无低估</li>
          <li>策略B 平均敞口远低于满仓，单边牛市跑输买入持有为结构性特征，核心看回撤与 Calmar</li>
          <li>QDII 历史多次暂停申购，回测假设全程可买</li>
          <li>交易费按设置值计入每笔买入，赎回费忽略</li>
        </ul>
      </details>

      <!-- 免责声明 -->
      <p class="mt-2 text-[10px] text-ink3">历史回测仅供策略研究，不构成投资建议</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LineChart from '@/components/LineChart.vue'
import { api } from '@/lib/api'
import { fundApi, type FundSearchItem } from '@/repos/fundRepo'

// ---------------------------------------------------------------- 类型 (与 public/backtest-data.json 对齐)

interface BtMetrics {
  totalInvested: number
  endValue: number
  totalReturnPct: number
  xirrPct: number | null
  maxDrawdownPct: number
  maxDrawdownMonths: number
  annualizedVolPct: number
  sharpe: number | null
  winRatePct: number
  // 以下字段产物暂未产出, 服务端后续补齐后自动生效
  excessPct?: number
  excessAmount?: number
  fxContributionPct?: number
  losingYears?: { count: number; worstYear: number; worstDiffPct: number }
  calmarRatio?: number
}
interface BtYearly { year: number; invested: number; wealth: number; totalReturnPct: number; fx?: number }
interface BtWindow { metrics: BtMetrics | null; yearly?: BtYearly[]; note?: string }
interface BtCurves {
  strategy: number[]
  benchmarkFixed?: number[]
  benchmarkLump?: number[]
  benchmarkBuyHold?: number[]
  benchmarkMoneyFund?: number[]
  benchmarkMoneyFundB?: number[]
}
type FeeBucket = { windows: Record<string, BtWindow | null> }
interface BtTarget {
  name: string
  currency: string
  fees: Record<string, FeeBucket | undefined> & { curves?: { full?: BtCurves } }
  channel?: Record<string, FeeBucket | undefined>
}
interface BtArtifact { generatedAt: string; targets: Record<string, BtTarget> }
interface LineSeriesLocal { label: string; data: (number | null)[]; color?: string; fill?: boolean }

// ---------------------------------------------------------------- 常量

const CHIP_ORDER = ['1.000001', '1.000300', '1.000905', '0.399006', '100.NDX', '100.SPX', '513100', '513500']
const QDII_SECIDS = new Set(['513100', '513500'])
const FEE_PRESET_KEYS = ['0', '0.0005', '0.0015', '0.003'] as const
const DEFAULT_FEE_KEY = '0.0005'
const WINDOW_DEFS = [
  { key: 'y5', label: '近5年' },
  { key: 'y10', label: '近10年' },
  { key: 'full', label: '全区间' }
] as const
type WindowKey = typeof WINDOW_DEFS[number]['key']

const props = withDefaults(defineProps<{
  strategy: 'a' | 'b'
  currentSecid?: string
  currentName?: string
}>(), { currentSecid: '', currentName: '' })

const baseAmount = props.strategy === 'a' ? 1000 : 100000

// ---------------------------------------------------------------- 状态

const artifact = ref<BtArtifact | null>(null)
const loading = ref(true)
const loadError = ref(false)

const selected = ref('')
const customMode = ref(false)
const customOpen = ref(false)
const customName = ref('')
const windowKey = ref<WindowKey>('full')
const amount = ref(baseAmount)
const customAmount = ref<number | null>(null)
const feeSel = ref<string>(DEFAULT_FEE_KEY)
const customFeePct = ref<number | null>(null)

const apiMetrics = ref<BtMetrics | null>(null)
const apiName = ref('')
const apiLoading = ref(false)
const apiError = ref(false)
const apiErrorMsg = ref('')
let apiSeq = 0
let apiTimer: ReturnType<typeof setTimeout> | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined

const searchKey = ref('')
const searchResults = ref<FundSearchItem[]>([])
const searching = ref(false)
const advSecid = ref('')
const advErr = ref('')

const feeOptions = [
  { key: '0', label: '0 免佣' },
  { key: '0.0005', label: '0.05%' },
  { key: '0.0015', label: '0.15%' },
  { key: '0.003', label: '0.3%' }
]
const amountPresets = props.strategy === 'a' ? [500, 1000, 2000, 3000, 5000] : [10000, 50000, 100000, 200000, 500000]

// ---------------------------------------------------------------- 产物加载

async function loadArtifact() {
  loading.value = true
  loadError.value = false
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}backtest-data.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    artifact.value = (await res.json()) as BtArtifact
    if (!selected.value) initSelection()
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function mapCurrentSecid(): string | null {
  const c = props.currentSecid
  if (!c || !artifact.value) return null
  if (c === '^NDX') return '100.NDX'
  if (c === '^GSPC') return '100.SPX'
  if (artifact.value.targets[c]) return c
  return null
}

function initSelection() {
  const mapped = mapCurrentSecid()
  if (mapped && (props.strategy === 'a' || artifact.value?.targets[mapped]?.channel)) {
    selected.value = mapped
    return
  }
  selected.value = presetChips.value[0]?.secid ?? ''
}

// ---------------------------------------------------------------- 标的选择

const presetChips = computed(() => {
  const t = artifact.value?.targets
  if (!t) return [] as { secid: string; name: string }[]
  const keys = Object.keys(t).filter(k => props.strategy === 'a' || !!t[k].channel)
  keys.sort((a, b) => {
    const ia = CHIP_ORDER.indexOf(a)
    const ib = CHIP_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  return keys.map(secid => ({ secid, name: t[secid].name }))
})

function pickPreset(secid: string) {
  customMode.value = false
  customOpen.value = false
  selected.value = secid
  feeSel.value = DEFAULT_FEE_KEY // 场内/指数默认 0.05%
}

function pickFund(it: FundSearchItem) {
  customMode.value = true
  customOpen.value = false
  selected.value = it.code
  customName.value = it.name
  apiName.value = ''
  feeSel.value = '0.0015' // 场外基金默认 0.15%
  searchKey.value = ''
  searchResults.value = []
}

function applyAdv() {
  const v = advSecid.value.trim()
  if (!/^(\d{6}|[01]\.\d{6}|100\.[A-Za-z]+)$/.test(v)) {
    advErr.value = '格式示例：001594 / 1.000300 / 100.NDX'
    return
  }
  advErr.value = ''
  customMode.value = true
  customOpen.value = false
  selected.value = v
  customName.value = v
  apiName.value = ''
  feeSel.value = DEFAULT_FEE_KEY
}

function onSearchKey() {
  if (searchTimer) clearTimeout(searchTimer)
  const k = searchKey.value.trim()
  if (k.length < 2) {
    searchResults.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    try {
      searchResults.value = await fundApi.search(k)
    } catch {
      searchResults.value = []
    } finally {
      searching.value = false
    }
  }, 400)
}

// ---------------------------------------------------------------- 数据解析 (零请求路径)

const effectiveFee = computed(() => {
  if (feeSel.value !== 'custom') return Number(feeSel.value)
  const v = customFeePct.value
  if (v == null || !Number.isFinite(v)) return 0
  return Math.min(Math.max(v, 0), 3) / 100
})

/** 命中预设费率档时返回对应 key, 用于直接读产物 */
const matchedPresetFeeKey = computed(() =>
  FEE_PRESET_KEYS.find(k => Math.abs(Number(k) - effectiveFee.value) < 1e-9) ?? null
)

const isPresetTarget = computed(() =>
  !customMode.value &&
  !!artifact.value?.targets[selected.value] &&
  (props.strategy === 'a' || !!artifact.value.targets[selected.value].channel)
)

/** 预置标的 + 预设费率档 → 直接读产物, 零请求 */
const zeroRequest = computed(() => isPresetTarget.value && matchedPresetFeeKey.value !== null)

const currentTarget = computed(() => (isPresetTarget.value ? artifact.value!.targets[selected.value] : null))

const currency = computed(() => {
  if (currentTarget.value) return currentTarget.value.currency
  return selected.value.startsWith('100.') ? 'USD' : 'CNY'
})
const isQdii = computed(() => isPresetTarget.value && QDII_SECIDS.has(selected.value))

const localWindow = computed<BtWindow | null>(() => {
  if (!zeroRequest.value) return null
  const t = artifact.value!.targets[selected.value]
  const key = matchedPresetFeeKey.value!
  const bucket = props.strategy === 'a' ? t.fees[key] : t.channel?.[key]
  return bucket?.windows?.[windowKey.value] ?? null
})

const windowsAvail = computed(() => {
  if (!isPresetTarget.value) return [...WINDOW_DEFS] // 自定义标的由服务端判断, 全量展示
  const t = artifact.value!.targets[selected.value]
  const key = matchedPresetFeeKey.value ?? DEFAULT_FEE_KEY
  const bucket = props.strategy === 'a' ? t.fees[key] : t.channel?.[key]
  return WINDOW_DEFS.filter(w => bucket?.windows?.[w.key]?.metrics != null)
})

// ---------------------------------------------------------------- API 路径 (自定义标的 / 自定义费率)

const needApi = computed(() => !zeroRequest.value && selected.value !== '')

async function runApi() {
  const seq = ++apiSeq
  apiLoading.value = true
  apiError.value = false
  apiErrorMsg.value = ''
  try {
    const r = await api.get<{ code: number; message: string; data: { name?: string; metrics: BtMetrics } }>(
      `/api/backtest?target=${encodeURIComponent(selected.value)}&fee=${effectiveFee.value}` +
      `&amountBase=${amount.value}&window=${windowKey.value}&strategy=${props.strategy}`
    )
    if (seq !== apiSeq) return
    apiMetrics.value = r.data.metrics
    if (r.data.name) apiName.value = r.data.name
  } catch (e) {
    if (seq !== apiSeq) return
    apiMetrics.value = null
    apiError.value = true
    apiErrorMsg.value = e instanceof Error ? e.message : ''
  } finally {
    if (seq === apiSeq) apiLoading.value = false
  }
}

function scheduleApi() {
  if (apiTimer) clearTimeout(apiTimer)
  apiTimer = setTimeout(() => { void runApi() }, 500)
}

function retryApi() {
  if (needApi.value) void runApi()
}

watch([selected, customMode, effectiveFee, amount, windowKey], () => {
  if (!artifact.value) return
  if (zeroRequest.value) {
    apiSeq++
    apiMetrics.value = null
    apiError.value = false
    apiLoading.value = false
    return
  }
  if (needApi.value) scheduleApi()
})

// 窗口不可用时回退到第一个可用窗口
watch(windowsAvail, list => {
  if (list.length > 0 && !list.some(w => w.key === windowKey.value)) windowKey.value = list[0].key
})

// ---------------------------------------------------------------- 展示数据

const metrics = computed<BtMetrics | null>(() => (zeroRequest.value ? localWindow.value?.metrics ?? null : apiMetrics.value))

const amtScale = computed(() => (zeroRequest.value ? amount.value / baseAmount : 1)) // API 路径已按 amountBase 计算

function calmarOf(m: BtMetrics): number | null {
  if (m.calmarRatio != null) return m.calmarRatio
  if (m.xirrPct != null && m.maxDrawdownPct > 0) return m.xirrPct / m.maxDrawdownPct
  return null
}

const metricTiles = computed(() => {
  const m = metrics.value
  if (!m) return [] as { label: string; value: string; cls?: string }[]
  const pctCls = m.totalReturnPct >= 0 ? 'text-pos' : 'text-neg'
  const tiles = [
    { label: '累计投入', value: fmtMoney(m.totalInvested * amtScale.value) },
    { label: '期末资产', value: fmtMoney(m.endValue * amtScale.value) },
    { label: '总收益率', value: `${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct.toFixed(1)}%`, cls: pctCls },
    { label: '年化 (XIRR)', value: m.xirrPct != null ? `${m.xirrPct.toFixed(2)}%` : '—', cls: pctCls },
    { label: '最大回撤', value: `-${m.maxDrawdownPct.toFixed(1)}%`, cls: 'text-neg' },
    { label: '回撤持续', value: `${m.maxDrawdownMonths} 个月` },
    { label: '夏普比率', value: m.sharpe != null ? m.sharpe.toFixed(2) : '—' },
    { label: '月胜率', value: `${m.winRatePct.toFixed(0)}%` },
    { label: '年化波动率', value: `${m.annualizedVolPct.toFixed(1)}%` }
  ]
  if (props.strategy === 'b') {
    const cal = calmarOf(m)
    tiles.push({ label: 'Calmar', value: cal != null ? cal.toFixed(2) : '—' })
  }
  return tiles
})

// ---------------------------------------------------------------- TL;DR

/** TL;DR 固定基于默认费率档 full 窗口 (预置标的); 自定义标的用当前结果 */
const tldrMetrics = computed<BtMetrics | null>(() => {
  if (isPresetTarget.value) {
    const t = artifact.value!.targets[selected.value]
    const bucket = props.strategy === 'a' ? t.fees[DEFAULT_FEE_KEY] : t.channel?.[DEFAULT_FEE_KEY]
    return bucket?.windows?.full?.metrics ?? null
  }
  return apiMetrics.value
})

const tldrCurves = computed<BtCurves | null>(() =>
  isPresetTarget.value ? artifact.value!.targets[selected.value].fees.curves?.full ?? null : null
)

/** 跑赢普通定投的相对财富差 (%) */
const excessInfo = computed<number | null>(() => {
  const m = tldrMetrics.value
  if (!m) return null
  if (m.excessPct != null) return m.excessPct
  const c = tldrCurves.value
  if (!c?.benchmarkFixed?.length || !c.strategy.length) return null
  const s = c.strategy[c.strategy.length - 1]
  const b = c.benchmarkFixed[c.benchmarkFixed.length - 1]
  if (b <= 0) return null
  return (s / b - 1) * 100
})

/** 一次性买入基准大幅占优 → 趋势上涨提示 */
const lumpDominant = computed(() => {
  const c = tldrCurves.value
  if (!c?.benchmarkLump?.length || !c.strategy.length) return false
  const s = c.strategy[c.strategy.length - 1]
  const l = c.benchmarkLump[c.benchmarkLump.length - 1]
  return s > 0 && (l / s - 1) * 100 > 5
})

/** 买入持有基准期末净值 (策略B 对比用) */
const buyHoldEnd = computed<number | null>(() => {
  const c = tldrCurves.value
  if (!c?.benchmarkBuyHold?.length) return null
  return c.benchmarkBuyHold[c.benchmarkBuyHold.length - 1]
})

const tldrRangeLabel = computed(() => {
  if (isPresetTarget.value) {
    const yearly = artifact.value!.targets[selected.value].fees[DEFAULT_FEE_KEY]?.windows?.full?.yearly
    if (yearly && yearly.length > 0) return `${yearly[0].year}–${yearly[yearly.length - 1].year} 区间`
    return '全区间'
  }
  return WINDOW_DEFS.find(w => w.key === windowKey.value)?.label ?? '全区间'
})

const tldr = computed(() => {
  const m = tldrMetrics.value
  if (!m) return ''
  const x = m.xirrPct != null ? `${m.xirrPct.toFixed(2)}%` : '—'
  const parts = [`${tldrRangeLabel.value} XIRR 年化 ${x}，最大回撤 ${m.maxDrawdownPct.toFixed(1)}%`]
  if (props.strategy === 'a') {
    const ex = excessInfo.value
    if (ex != null) parts.push(`期末财富${ex >= 0 ? '跑赢' : '跑输'}普通定投 ${Math.abs(ex).toFixed(1)}%`)
    if (lumpDominant.value) parts.push('本区间为趋势上涨行情，一次性建仓占优')
  } else {
    const cal = calmarOf(m)
    if (cal != null) parts.push(`Calmar ${cal.toFixed(2)}`)
    const bh = buyHoldEnd.value
    if (bh != null && bh > 0 && m.totalInvested > 0) {
      parts.push(`期末净值为买入持有的 ${((m.endValue / m.totalInvested / bh) * 100).toFixed(0)}%`)
    }
  }
  return parts.join('，')
})

const tldrSub = computed(() => {
  const g = artifact.value?.generatedAt
  const date = g ? g.slice(0, 10) : ''
  const cal = props.strategy === 'a' ? '年化为 XIRR 口径' : '总财富对比口径'
  return `${tldrRangeLabel.value} · 数据生成于 ${date} · 来源：东方财富 · ${cal}`
})

// ---------------------------------------------------------------- 策略B 三基准对比

const bBenchText = computed(() => {
  if (props.strategy !== 'b' || !zeroRequest.value || windowKey.value !== 'full') return ''
  const c = tldrCurves.value
  const m = metrics.value
  if (!c || !m || m.totalInvested <= 0) return ''
  const parts = [`本策略期末净值 ${(m.endValue / m.totalInvested).toFixed(2)}`]
  if (c.benchmarkBuyHold?.length) parts.push(`买入持有 ${c.benchmarkBuyHold[c.benchmarkBuyHold.length - 1].toFixed(2)}`)
  if (c.benchmarkMoneyFundB?.length) parts.push(`货币基金 ${c.benchmarkMoneyFundB[c.benchmarkMoneyFundB.length - 1].toFixed(2)}`)
  return parts.length > 1 ? `期初 = 1 · ${parts.join(' · ')}` : ''
})

// ---------------------------------------------------------------- 跑输年份 (由默认档 full 曲线+逐年推导)

/** 将逐年财富匹配到曲线上的年末下标 (末点锚定, 倒序贪心) */
function matchYearEndIndices(yearly: BtYearly[], curve: number[]): number[] {
  const res = new Array<number>(yearly.length).fill(-1)
  const n = curve.length
  if (n === 0 || yearly.length === 0) return res
  const lastW = yearly[yearly.length - 1].wealth
  if (lastW <= 0 || curve[n - 1] <= 0) return res
  const scale = lastW / curve[n - 1]
  let prev = n
  for (let i = yearly.length - 1; i >= 0; i--) {
    const w = yearly[i].wealth
    if (w <= 0) continue
    const target = w / scale
    let best = -1
    let bestDiff = Infinity
    for (let j = prev - 1; j >= 0; j--) {
      const d = Math.abs(curve[j] - target)
      if (d < bestDiff) {
        bestDiff = d
        best = j
      }
    }
    if (best === -1) continue
    if (target > 1e-9 && bestDiff / target > 0.05) continue
    res[i] = best
    prev = best
  }
  return res
}

const losingDerived = computed(() => {
  if (props.strategy !== 'a') return null
  const m = metrics.value
  if (m?.losingYears) return { count: m.losingYears.count, worstYear: m.losingYears.worstYear, worstDiffPct: m.losingYears.worstDiffPct }
  if (!zeroRequest.value || windowKey.value !== 'full' || matchedPresetFeeKey.value !== DEFAULT_FEE_KEY) return null
  const yearly = localWindow.value?.yearly
  const c = tldrCurves.value
  if (!yearly || !c?.benchmarkFixed?.length || !c.strategy.length) return null
  const idx = matchYearEndIndices(yearly, c.strategy)
  let count = 0
  let worstDiff = 0
  let worstYear = 0
  for (let i = 1; i < yearly.length; i++) {
    const j0 = idx[i - 1]
    const j1 = idx[i]
    if (j0 < 0 || j1 < 0 || c.strategy[j0] <= 0 || c.benchmarkFixed[j0] <= 0) continue
    const gS = c.strategy[j1] / c.strategy[j0] - 1
    const gB = c.benchmarkFixed[j1] / c.benchmarkFixed[j0] - 1
    if (gS < gB) {
      count++
      const d = (gS - gB) * 100
      if (d < worstDiff) {
        worstDiff = d
        worstYear = yearly[i].year
      }
    }
  }
  if (count === 0) return { count: 0, worstYear: 0, worstDiffPct: 0 }
  return { count, worstYear, worstDiffPct: worstDiff }
})

const losingText = computed(() => {
  const l = losingDerived.value
  if (!l) return ''
  if (l.count === 0) return '回测区间内逐年均跑赢普通定投基准'
  return `跑输基准 ${l.count} 年（最差 ${l.worstYear} 年 ${l.worstDiffPct.toFixed(1)}pp）`
})

// ---------------------------------------------------------------- 资金曲线

function monthLabels(n: number, endIso: string): string[] {
  const d = new Date(endIso)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth()
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m + 1).padStart(2, '0')}`)
    m--
    if (m < 0) {
      m = 11
      y--
    }
  }
  return out
}

const chartData = computed(() => {
  if (props.strategy !== 'a') return null // 产物仅含策略A曲线
  if (!zeroRequest.value || windowKey.value !== 'full' || matchedPresetFeeKey.value !== DEFAULT_FEE_KEY) return null
  const c = tldrCurves.value
  if (!c?.strategy?.length) return null
  const n = c.strategy.length
  const stride = Math.max(1, Math.ceil(n / 120))
  const ds = (arr?: number[]) => (arr ? arr.filter((_, i) => i % stride === 0 || i === n - 1) : undefined)
  const sArr = ds(c.strategy)!
  const labels = monthLabels(sArr.length, artifact.value!.generatedAt)
  const series: LineSeriesLocal[] = [{ label: '本策略', data: sArr, color: '#10b981', fill: true }]
  const b1 = ds(c.benchmarkFixed)
  if (b1) series.push({ label: '普通定投', data: b1, color: '#6366f1' })
  const b2 = ds(c.benchmarkLump)
  if (b2) series.push({ label: '一次性买入', data: b2, color: '#f59e0b' })
  const b3 = ds(c.benchmarkMoneyFund)
  if (b3) series.push({ label: '货币基金', data: b3, color: '#94a3b8' })
  return { labels, series }
})

// ---------------------------------------------------------------- 逐年表

interface YearRow extends BtYearly { excessPts: number | null }

const yearlyRows = computed<YearRow[]>(() => {
  if (props.strategy !== 'a' || !zeroRequest.value || matchedPresetFeeKey.value !== DEFAULT_FEE_KEY) return []
  const yearly = localWindow.value?.yearly
  if (!yearly || yearly.length === 0) return []
  let excessMap: (number | null)[] = yearly.map(() => null)
  if (windowKey.value === 'full' && tldrCurves.value?.benchmarkFixed?.length) {
    const c = tldrCurves.value
    const idx = matchYearEndIndices(yearly, c.strategy)
    excessMap = yearly.map((_, i) => {
      if (i === 0) return null
      const j0 = idx[i - 1]
      const j1 = idx[i]
      if (j0 < 0 || j1 < 0 || c.strategy[j0] <= 0 || c.benchmarkFixed![j0] <= 0) return null
      return ((c.strategy[j1] / c.strategy[j0] - 1) - (c.benchmarkFixed![j1] / c.benchmarkFixed![j0] - 1)) * 100
    })
  }
  return yearly.map((r, i) => ({ ...r, excessPts: excessMap[i] }))
})

const hasYearlyExcess = computed(() => yearlyRows.value.some(r => r.excessPts != null))
const hasYearlyFx = computed(() => yearlyRows.value.some(r => r.fx != null))

// ---------------------------------------------------------------- 工具

function fmtMoney(n: number): string {
  return `¥${Math.round(n).toLocaleString('zh-CN')}`
}

function fmtWan(n: number): string {
  return n >= 10000 ? `${n / 10000}万` : `${n}`
}

function onCustomAmount() {
  const v = customAmount.value
  if (v == null || !Number.isFinite(v)) return
  const min = props.strategy === 'a' ? 100 : 1000
  const max = props.strategy === 'a' ? 100000 : 10000000
  amount.value = Math.min(Math.max(v, min), max)
}

// ---------------------------------------------------------------- 生命周期

onMounted(() => { void loadArtifact() })

onBeforeUnmount(() => {
  if (apiTimer) clearTimeout(apiTimer)
  if (searchTimer) clearTimeout(searchTimer)
  apiSeq++
})
</script>
