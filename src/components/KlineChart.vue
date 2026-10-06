<template>
  <div class="w-full select-none">
    <!-- 顶部: 视图 tab (分时/日K/周K/月K) + 复权 + 区间 + 对比开关 -->
    <div class="flex flex-wrap items-center justify-between gap-1 mb-1">
      <div class="flex items-center gap-1">
        <button v-for="v in VIEWS" :key="v.v" @click="switchView(v.v)"
          :class="['rounded-md px-2 py-0.5 text-[11px] font-medium transition', view === v.v ? 'bg-brand-soft text-brand' : 'text-ink3 hover:text-ink']">
          {{ v.label }}
        </button>
      </div>
      <div class="flex items-center gap-1">
        <button v-if="view !== 'trends'" v-for="f in FQS" :key="f.v" @click="switchFq(f.v)"
          :class="['rounded-md px-1.5 py-0.5 text-[11px] transition', fq === f.v ? 'bg-surface2 text-ink font-medium' : 'text-ink3 hover:text-ink']">
          {{ f.label }}
        </button>
        <button v-if="view !== 'trends' && kind === 'ohlc'" @click="showBench = !showBench" title="叠加沪深300对比"
          :class="['rounded-md px-1.5 py-0.5 text-[11px] transition', showBench ? 'bg-surface2 text-ink font-medium' : 'text-ink3 hover:text-ink']">
          对比沪深300
        </button>
        <button v-if="view !== 'trends'" v-for="opt in RANGES" :key="opt" @click="range = opt"
          :class="['rounded-md px-1.5 py-0.5 text-[11px] transition', range === opt ? 'bg-surface2 text-ink font-medium' : 'text-ink3 hover:text-ink']">
          {{ opt }}
        </button>
      </div>
    </div>

    <!-- 指标值行 -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4 mb-0.5 min-h-16px">
      <template v-if="view === 'trends'">
        <span :class="trendsChg >= 0 ? 'text-pos' : 'text-neg'">
          现价 {{ trendsLast?.price ?? '--' }} {{ trendsChg >= 0 ? '+' : '' }}{{ trendsChg.toFixed(2) }}%
        </span>
        <span class="text-ink3">均价 {{ trendsLast?.avg?.toFixed(2) ?? '--' }} · 昨收 {{ preClose || '--' }}</span>
      </template>
      <template v-else-if="kind === 'ohlc'">
        <span v-for="(m, i) in maRows" :key="m.p" :style="{ color: MA_COLORS[i] }">
          MA{{ m.p }} {{ m.v != null ? m.v.toFixed(2) : '--' }}
        </span>
        <span v-if="benchOn" class="text-orange-400">沪深300 {{ benchChg >= 0 ? '+' : '' }}{{ benchChg.toFixed(2) }}%</span>
      </template>
      <span v-else class="text-ink3">场外基金无盘口价 · 以单位净值绘蜡烛</span>
    </div>

    <div class="relative w-full" :style="{ height: height + 'px' }">
      <canvas ref="canvasRef" class="w-full h-full block touch-none" :class="view !== 'trends' ? 'cursor-crosshair' : ''"
        @mousemove="onMove" @mouseleave="hover = null"
        @wheel.prevent="onWheel" @mousedown="onDown" @touchstart.passive="onTouchStart"
        @touchmove.prevent="onTouchMove" @touchend="onTouchEnd"></canvas>
      <div v-if="loading" class="absolute inset-0 grid place-items-center text-xs text-ink3 bg-surface/60">加载中…</div>
      <div v-else-if="error" class="absolute inset-0 grid place-items-center text-xs text-neg bg-surface/60">{{ error }}</div>
      <div v-else-if="view !== 'trends' && canZoom" class="absolute left-1 bottom-4 text-[9px] text-ink3/60">滚轮缩放 · 拖动平移</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { api } from '@/lib/api'

export interface KlineBar { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface TrendPoint { time: string; price: number; avg: number; volume: number }

const props = withDefaults(defineProps<{ symbol: string; height?: number }>(), { height: 300 })

/** 视图: 分时 / 日K / 周K / 月K */
const VIEWS = [
  { v: 'trends', label: '分时' },
  { v: 'day', label: '日K' },
  { v: 'week', label: '周K' },
  { v: 'month', label: '月K' }
] as const
type View = typeof VIEWS[number]['v']
const view = ref<View>('day')

const FQS = [{ v: 1, label: '前复权' }, { v: 0, label: '不复权' }] as const
const fq = ref<0 | 1>(1)

const RANGES = ['1月', '3月', '6月', '全部'] as const
type Range = typeof RANGES[number]
const range = ref<Range>('3月')
const rangeCount = computed(() => (range.value === '1月' ? 22 : range.value === '3月' ? 66 : range.value === '6月' ? 132 : 5000))

const showBench = ref(false)

const MA_PERIODS = [5, 10, 20, 60] as const
const MA_COLORS = ['#e6e6e6', '#f2c14e', '#c78ae0', '#4ea1f2']
const UP = '#e0342f', DOWN = '#1a9c5d'
const GRID = 'rgba(128,128,128,0.14)'
const AXIS = 'rgba(128,128,128,0.75)'
const BENCH_COLOR = '#f97316'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const loading = ref(false)
const error = ref('')
const kind = ref<'ohlc' | 'nav'>('ohlc')
const allBars = ref<KlineBar[]>([])
const trendPoints = ref<TrendPoint[]>([])
const preClose = ref(0)
const hover = ref<number | null>(null)
const benchBars = ref<KlineBar[]>([]) // 沪深300 对比 (日K归一化百分比)

/** 缩放/平移状态: 可见窗口 [viewStart, viewEnd) 在 allBars 的索引区间 */
const winStart = ref(0)
const winSize = ref(0)
const canZoom = computed(() => allBars.value.length > 0 && view.value !== 'trends')
const visible = computed(() => {
  if (view.value === 'trends') return []
  const arr = allBars.value
  if (!arr.length) return []
  const size = winSize.value || Math.min(rangeCount.value, arr.length)
  const start = Math.max(0, Math.min(winStart.value, arr.length - size))
  return arr.slice(start, start + size)
})
const benchOn = computed(() => showBench.value && benchBars.value.length > 0)

/** 请求缓存 */
const cache = new Map<string, { kind: 'ohlc' | 'nav'; bars: KlineBar[] }>()
const trendsCache = new Map<string, { points: TrendPoint[]; preClose: number }>()

async function load(): Promise<void> {
  if (!/^\d{6}$/.test(props.symbol)) { error.value = '仅支持 A股/基金代码'; return }
  loading.value = true
  error.value = ''
  try {
    if (view.value === 'trends') {
      const key = props.symbol
      const hit = trendsCache.get(key)
      if (hit) { trendPoints.value = hit.points; preClose.value = hit.preClose }
      else {
        const r = await api.get<{ points: TrendPoint[]; preClose: number }>(`/api/market/trends?symbol=${props.symbol}`)
        trendsCache.set(key, { points: r.points || [], preClose: r.preClose || 0 })
        trendPoints.value = r.points || []
        preClose.value = r.preClose || 0
      }
    } else {
      const key = `${props.symbol}:${view.value}:${fq.value}`
      const hit = cache.get(key)
      if (hit) { kind.value = hit.kind; allBars.value = hit.bars }
      else {
        const r = await api.get<{ kind: 'ohlc' | 'nav'; bars: KlineBar[] }>(`/api/market/kline?symbol=${props.symbol}&period=${view.value}&fqt=${fq.value}`)
        cache.set(key, { kind: r.kind || 'ohlc', bars: r.bars || [] })
        kind.value = r.kind || 'ohlc'
        allBars.value = r.bars || []
      }
      resetWindow()
      if (showBench.value && view.value === 'day') await loadBench()
    }
    draw()
  } catch (e) {
    error.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadBench(): Promise<void> {
  try {
    const r = await api.get<{ bars: KlineBar[] }>(`/api/market/kline?symbol=000300&period=day&fqt=1`)
    benchBars.value = r.bars || []
  } catch { benchBars.value = [] }
}

function resetWindow(): void {
  const n = allBars.value.length
  const size = Math.min(rangeCount.value, n)
  winStart.value = Math.max(0, n - size)
  winSize.value = size
}

function switchView(v: View): void {
  if (view.value === v) return
  view.value = v
  hover.value = null
}
function switchFq(f: 0 | 1): void {
  if (fq.value === f) return
  fq.value = f
  hover.value = null
}

// ---- 缩放/平移 ----
function onWheel(ev: WheelEvent): void {
  if (view.value === 'trends' || !allBars.value.length) return
  const rect = canvasRef.value!.getBoundingClientRect()
  const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
  const n = allBars.value.length
  const curSize = winSize.value || n
  const factor = ev.deltaY > 0 ? 1.2 : 1 / 1.2
  const newSize = Math.round(Math.max(10, Math.min(n, curSize * factor)))
  const anchor = winStart.value + frac * curSize // 鼠标位置锚定
  winStart.value = Math.max(0, Math.min(n - newSize, Math.round(anchor - frac * newSize)))
  winSize.value = newSize
  hover.value = null
  draw()
}
let dragX = -1
function onDown(ev: MouseEvent): void { dragX = ev.clientX }
function windowMoveEventHandler(ev: MouseEvent): void {
  if (dragX < 0 || view.value === 'trends' || !allBars.value.length) return
  const rect = canvasRef.value!.getBoundingClientRect()
  const n = allBars.value.length
  const size = winSize.value || n
  const dxIdx = Math.round(((dragX - ev.clientX) / rect.width) * size)
  if (dxIdx === 0) return
  dragX = ev.clientX
  winStart.value = Math.max(0, Math.min(n - size, winStart.value + dxIdx))
  hover.value = null
  draw()
}
onMounted(() => window.addEventListener('mousemove', windowMoveEventHandler))
onBeforeUnmount(() => window.removeEventListener('mousemove', windowMoveEventHandler))
let touchX = -1
function onTouchStart(ev: TouchEvent): void { touchX = ev.touches[0]?.clientX ?? -1 }
function onTouchEnd(): void { touchX = -1 }
function onTouchMove(ev: TouchEvent): void {
  if (touchX < 0 || view.value === 'trends' || !allBars.value.length) return
  const x = ev.touches[0]?.clientX
  if (x == null) return
  const rect = canvasRef.value!.getBoundingClientRect()
  const n = allBars.value.length
  const size = winSize.value || n
  const dxIdx = Math.round(((touchX - x) / rect.width) * size)
  if (dxIdx === 0) return
  touchX = x
  winStart.value = Math.max(0, Math.min(n - size, winStart.value + dxIdx))
  hover.value = null
  draw()
}

// ---- 分时指标 ----
const trendsLast = computed(() => (trendPoints.value.length ? trendPoints.value[trendPoints.value.length - 1] : null))
const trendsChg = computed(() => {
  const last = trendsLast.value
  if (!last || !preClose.value) return 0
  return ((last.price - preClose.value) / preClose.value) * 100
})

// ---- MA ----
function maOf(idx: number, p: number): number | null {
  const arr = allBars.value
  const gi = winStart.value + idx
  if (gi + 1 < p) return null
  let sum = 0
  for (let k = gi - p + 1; k <= gi; k++) sum += arr[k].close
  return sum / p
}
const maRows = computed(() => {
  if (view.value === 'trends' || kind.value !== 'ohlc') return []
  const idx = hover.value != null ? hover.value : visible.value.length - 1
  return MA_PERIODS.map(p => ({ p, v: maOf(idx, p) }))
})
const benchChg = computed(() => {
  // 对比基准: 可见区间内涨跌幅 (末根 vs 首根收盘)
  const b = benchBars.value
  if (!benchOn.value || b.length < 2) return 0
  const n = allBars.value.length
  const start = winStart.value
  const first = b[Math.max(0, b.length - (n - start) - 1 + 0)] || b[0]
  const last = b[b.length - 1]
  if (!first || !last) return 0
  return ((last.close - first.close) / first.close) * 100
})

function fmtVol(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万'
  return String(v)
}
function fmtPrice(v: number): string {
  return v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(3)
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || 320
  const cssH = props.height
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, cssW, cssH)

  if (view.value === 'trends') { drawTrends(ctx, cssW, cssH); return }

  const data = visible.value
  if (data.length < 2) return
  const isNav = kind.value === 'nav'

  const padL = 6, padR = 56, padT = 4, padB = 16
  const plotW = cssW - padL - padR
  const volH = isNav ? 0 : Math.max(36, Math.round((cssH - padT - padB) * 0.26))
  const gap = isNav ? 0 : 8
  const mainH = cssH - padT - padB - volH - gap
  const mainT = padT
  const volT = padT + mainH + gap
  const step = plotW / data.length
  const bodyW = Math.max(1, Math.min(12, step * 0.7))

  // 价格范围 (含 MA 与基准)
  let lo = Infinity, hi = -Infinity
  for (const b of data) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high }
  if (!isNav) {
    for (let i = 0; i < data.length; i++)
      for (const p of MA_PERIODS) { const v = maOf(i, p); if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v } }
  }
  const yOf = (v: number) => mainT + ((hi - v) / (hi - lo)) * mainH

  // 网格 + 价格轴
  ctx.font = '10px ui-sans-serif, system-ui'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4
    const y = yOf(v)
    ctx.strokeStyle = GRID; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke()
    ctx.fillStyle = AXIS; ctx.textAlign = 'left'
    ctx.fillText(fmtPrice(v), padL + plotW + 4, y)
  }

  // 最新价虚线 + 标签
  const lastBar = data[data.length - 1]
  const lastY = yOf(lastBar.close)
  const lastUp = lastBar.close >= lastBar.open
  ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = lastUp ? UP : DOWN
  ctx.beginPath(); ctx.moveTo(padL, lastY); ctx.lineTo(padL + plotW, lastY); ctx.stroke(); ctx.restore()
  ctx.fillStyle = lastUp ? UP : DOWN
  ctx.fillRect(padL + plotW, lastY - 7, padR - 2, 14)
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
  ctx.fillText(fmtPrice(lastBar.close), padL + plotW + 4, lastY)

  // 基准对比线 (归一化叠加): 把沪深300收盘按 (1 + pct) 映射到首根收盘
  if (benchOn.value && view.value === 'day') {
    const n = allBars.value.length
    const start = winStart.value
    const b = benchBars.value
    const baseClose = data[0].close
    const bBaseIdx = b.length - (n - start) // bench 对应窗口首根的索引
    ctx.strokeStyle = BENCH_COLOR; ctx.lineWidth = 1; ctx.setLineDash([])
    ctx.beginPath()
    let started = false
    for (let i = 0; i < data.length; i++) {
      const bi = bBaseIdx + i
      if (bi < 0 || bi >= b.length) { started = false; continue }
      const pct = (b[bi].close - b[Math.max(0, bBaseIdx)].close) / b[Math.max(0, bBaseIdx)].close
      const v = baseClose * (1 + pct)
      const x = padL + i * step + step / 2
      const y = yOf(v)
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // 蜡烛
  data.forEach((b, i) => {
    const x = padL + i * step + step / 2
    const up = b.close >= b.open
    const color = up ? UP : DOWN
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1
    if (!isNav) { ctx.beginPath(); ctx.moveTo(x, yOf(b.high)); ctx.lineTo(x, yOf(b.low)); ctx.stroke() }
    const yO = yOf(b.open), yC = yOf(b.close)
    ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)))
  })

  // MA 均线
  if (!isNav) {
    ctx.lineWidth = 1
    MA_PERIODS.forEach((p, pi) => {
      ctx.strokeStyle = MA_COLORS[pi]
      ctx.beginPath()
      let started = false
      for (let i = 0; i < data.length; i++) {
        const v = maOf(i, p)
        if (v == null) { started = false; continue }
        const x = padL + i * step + step / 2
        const y = yOf(v)
        if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
      }
      ctx.stroke()
    })
  }

  // 成交量副图
  if (!isNav && volH > 0) {
    let vMax = 0
    for (const b of data) if (b.volume > vMax) vMax = b.volume
    if (vMax <= 0) vMax = 1
    const yVolOf = (v: number) => volT + volH - (v / vMax) * (volH - 4)
    ctx.strokeStyle = GRID
    ctx.beginPath(); ctx.moveTo(padL, volT + volH); ctx.lineTo(padL + plotW, volT + volH); ctx.stroke()
    ctx.fillStyle = AXIS; ctx.textAlign = 'left'
    ctx.fillText(fmtVol(vMax), padL + plotW + 4, volT + 4)
    data.forEach((b, i) => {
      const x = padL + i * step + step / 2
      ctx.fillStyle = b.close >= b.open ? UP : DOWN
      const y = yVolOf(b.volume)
      ctx.fillRect(x - bodyW / 2, y, bodyW, volT + volH - y)
    })
  }

  // 日期轴
  ctx.fillStyle = AXIS; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  const tick = (d: string) => (view.value === 'month' ? d.slice(0, 7) : d.slice(5))
  const labels: Array<[number, string]> = [
    [padL + 14, tick(data[0].date)],
    [padL + plotW / 2, tick(data[Math.floor(data.length / 2)].date)],
    [padL + plotW - 14, tick(lastBar.date)]
  ]
  for (const [x, t] of labels) ctx.fillText(t, x, cssH - 4)

  // 十字光标 + 信息面板
  if (hover.value != null) {
    const i = hover.value
    const b = data[i]
    const cx = padL + i * step + step / 2
    ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(120,120,120,0.5)'
    ctx.beginPath(); ctx.moveTo(cx, mainT); ctx.lineTo(cx, isNav ? mainT + mainH : volT + volH); ctx.stroke()
    const cy = yOf(b.close)
    ctx.beginPath(); ctx.moveTo(padL, cy); ctx.lineTo(padL + plotW, cy); ctx.stroke()
    ctx.restore()
    const label = b.date
    ctx.font = '10px ui-sans-serif, system-ui'
    const tw = ctx.measureText(label).width + 8
    ctx.fillStyle = 'rgba(60,60,60,0.9)'
    ctx.fillRect(Math.min(Math.max(cx - tw / 2, padL), padL + plotW - tw), cssH - 14, tw, 12)
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
    ctx.fillText(label, Math.min(Math.max(cx, padL + tw / 2), padL + plotW - tw / 2), cssH - 4)
    const prev = i > 0 ? data[i - 1] : null
    const chg = prev ? ((b.close - prev.close) / prev.close) * 100 : null
    const lines = [
      b.date,
      `开 ${b.open}  高 ${b.high}`,
      `低 ${b.low}  收 ${b.close}` + (chg != null ? `  ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : ''),
      isNav ? '' : `量 ${fmtVol(b.volume)}  振 ${prev ? (((b.high - b.low) / prev.close) * 100).toFixed(2) : '--'}%`
    ].filter(Boolean)
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    let ly = mainT + 2
    for (const ln of lines) {
      const w = ctx.measureText(ln).width + 10
      ctx.fillStyle = 'rgba(30,30,30,0.82)'
      ctx.fillRect(padL + 2, ly, w, 14)
      ctx.fillStyle = chg != null && ln.includes('%') && chg < 0 ? '#7ee2a8' : '#eee'
      ctx.fillText(ln, padL + 7, ly + 1)
      ly += 15
    }
  }
}

/** 分时图: 走势线 + 均价线 + 昨收虚线 + 涨跌区着色 */
function drawTrends(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void {
  const pts = trendPoints.value
  if (pts.length < 2) {
    ctx.fillStyle = AXIS; ctx.font = '11px ui-sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('暂无分时数据 (非交易时段或场外基金)', cssW / 2, cssH / 2)
    return
  }
  const padL = 6, padR = 56, padT = 4, padB = 16
  const plotW = cssW - padL - padR
  const mainH = cssH - padT - padB
  const pre = preClose.value || pts[0].price
  let hi = pre, lo = pre
  for (const p of pts) { if (p.price > hi) hi = p.price; if (p.price < lo) lo = p.price; if (p.avg > hi) hi = p.avg; if (p.avg < lo) lo = p.avg }
  const span = Math.max((hi - lo) * 0.1, pre * 0.002)
  hi += span; lo -= span
  const xOf = (i: number) => padL + (i / (pts.length - 1)) * plotW
  const yOf = (v: number) => padT + ((hi - v) / (hi - lo)) * mainH

  // 网格 + 轴
  ctx.font = '10px ui-sans-serif, system-ui'; ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4
    const y = yOf(v)
    ctx.strokeStyle = GRID
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke()
    ctx.fillStyle = AXIS; ctx.textAlign = 'left'
    const pct = ((v - pre) / pre) * 100
    ctx.fillText(`${fmtPrice(v)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`, padL + plotW + 4, y)
  }

  // 昨收虚线
  const yPre = yOf(pre)
  ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(120,120,120,0.6)'
  ctx.beginPath(); ctx.moveTo(padL, yPre); ctx.lineTo(padL + plotW, yPre); ctx.stroke(); ctx.restore()

  // 涨跌区着色 (昨收上方淡红/下方淡绿)
  const upY = yPre, upH = yOf(hi)
  ctx.fillStyle = 'rgba(224,52,47,0.05)'
  ctx.fillRect(padL, Math.min(upY, upH), plotW, Math.abs(upY - upH))
  ctx.fillStyle = 'rgba(26,156,93,0.05)'
  ctx.fillRect(padL, Math.min(upY, yOf(lo)), plotW, Math.abs(upY - yOf(lo)))

  // 走势线
  ctx.strokeStyle = '#4ea1f2'; ctx.lineWidth = 1
  ctx.beginPath()
  pts.forEach((p, i) => { const x = xOf(i), y = yOf(p.price); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
  ctx.stroke()
  // 均价线 (黄)
  ctx.strokeStyle = '#f2c14e'
  ctx.beginPath()
  pts.forEach((p, i) => { const x = xOf(i), y = yOf(p.avg); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
  ctx.stroke()

  // 十字光标
  if (hover.value != null) {
    const i = Math.min(hover.value, pts.length - 1)
    const p = pts[i]
    const cx = xOf(i)
    ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(120,120,120,0.5)'
    ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + mainH); ctx.stroke()
    const cy = yOf(p.price)
    ctx.beginPath(); ctx.moveTo(padL, cy); ctx.lineTo(padL + plotW, cy); ctx.stroke()
    ctx.restore()
    // 时间气泡
    ctx.font = '10px ui-sans-serif, system-ui'
    const tw = ctx.measureText(p.time).width + 8
    ctx.fillStyle = 'rgba(60,60,60,0.9)'
    ctx.fillRect(Math.min(Math.max(cx - tw / 2, padL), padL + plotW - tw), cssH - 14, tw, 12)
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
    ctx.fillText(p.time, Math.min(Math.max(cx, padL + tw / 2), padL + plotW - tw / 2), cssH - 4)
    // 信息面板
    const chg = ((p.price - pre) / pre) * 100
    const lines = [
      `${p.time}  价 ${p.price}  ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`,
      `均价 ${p.avg.toFixed(2)}  量 ${fmtVol(p.volume)}`
    ]
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    let ly = padT + 2
    for (const ln of lines) {
      const w = ctx.measureText(ln).width + 10
      ctx.fillStyle = 'rgba(30,30,30,0.82)'
      ctx.fillRect(padL + 2, ly, w, 14)
      ctx.fillStyle = '#eee'
      ctx.fillText(ln, padL + 7, ly + 1)
      ly += 15
    }
  }

  // 时间轴 3 刻度
  ctx.fillStyle = AXIS; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  const ticks: Array<[number, string]> = [[0, pts[0].time], [Math.floor(pts.length / 2), pts[Math.floor(pts.length / 2)].time], [pts.length - 1, pts[pts.length - 1].time]]
  for (const [i, t] of ticks) ctx.fillText(t, xOf(i), cssH - 4)
}

function onMove(ev: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = ev.clientX - rect.left
  const padL = 6, padR = 56
  const plotW = rect.width - padL - padR
  if (view.value === 'trends') {
    const n = trendPoints.value.length
    if (n < 2) return
    const idx = Math.round(((x - padL) / plotW) * (n - 1))
    hover.value = idx >= 0 && idx < n ? idx : null
  } else {
    const data = visible.value
    if (data.length < 2) return
    const idx = Math.floor(((x - padL) / plotW) * data.length)
    hover.value = idx >= 0 && idx < data.length ? idx : null
  }
  draw()
}

let ro: ResizeObserver | null = null
onMounted(() => {
  load()
  ro = new ResizeObserver(() => draw())
  if (canvasRef.value) ro.observe(canvasRef.value)
})
onBeforeUnmount(() => { ro?.disconnect() })

watch(() => props.symbol, () => { allBars.value = []; trendPoints.value = []; benchBars.value = []; hover.value = null; load() })
watch(view, () => load())
watch(fq, () => load())
watch(range, () => { resetWindow(); hover.value = null; draw() })
watch(showBench, async () => { if (showBench.value && view.value === 'day' && !benchBars.value.length) await loadBench(); draw() })
</script>
