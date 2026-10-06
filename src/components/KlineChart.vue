<template>
  <div class="w-full select-none">
    <!-- 顶部: 周期 + 区间 -->
    <div class="flex items-center justify-between mb-1">
      <div class="flex items-center gap-1">
        <button v-for="p in PERIODS" :key="p.v" @click="switchPeriod(p.v)"
          :class="['rounded-md px-2 py-0.5 text-[11px] font-medium transition', period === p.v ? 'bg-brand-soft text-brand' : 'text-ink3 hover:text-ink']">
          {{ p.label }}
        </button>
      </div>
      <div class="flex items-center gap-1">
        <button v-for="opt in RANGES" :key="opt" @click="range = opt"
          :class="['rounded-md px-1.5 py-0.5 text-[11px] transition', range === opt ? 'bg-surface2 text-ink font-medium' : 'text-ink3 hover:text-ink']">
          {{ opt }}
        </button>
      </div>
    </div>

    <!-- MA 值行 (悬停显示对应 K 线的 MA, 否则显示最新) -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4 mb-0.5">
      <template v-if="kind === 'ohlc'">
        <span v-for="(m, i) in maRows" :key="m.p" :style="{ color: MA_COLORS[i] }">
          MA{{ m.p }} {{ m.v != null ? m.v.toFixed(2) : '--' }}
        </span>
      </template>
      <span v-else class="text-ink3">场外基金无盘口价 · 以单位净值绘蜡烛</span>
    </div>

    <div class="relative w-full" :style="{ height: height + 'px' }">
      <canvas ref="canvasRef" class="w-full h-full block" @mousemove="onMove" @mouseleave="hover = null"></canvas>
      <div v-if="loading" class="absolute inset-0 grid place-items-center text-xs text-ink3 bg-surface/60">K线加载中…</div>
      <div v-else-if="error" class="absolute inset-0 grid place-items-center text-xs text-neg bg-surface/60">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { api } from '@/lib/api'

export interface KlineBar { date: string; open: number; high: number; low: number; close: number; volume: number }

const props = withDefaults(defineProps<{
  symbol: string
  height?: number
}>(), { height: 300 })

const PERIODS = [
  { v: 'day', label: '日K' },
  { v: 'week', label: '周K' },
  { v: 'month', label: '月K' }
] as const
type Period = typeof PERIODS[number]['v']
const period = ref<Period>('day')

const RANGES = ['1月', '3月', '6月', '全部'] as const
type Range = typeof RANGES[number]
const range = ref<Range>('3月')
const rangeCount = computed(() => (range.value === '1月' ? 22 : range.value === '3月' ? 66 : range.value === '6月' ? 132 : 5000))

/** MA 周期与配色 (对齐主流行情软件: 白/黄/紫/绿) */
const MA_PERIODS = [5, 10, 20, 60] as const
const MA_COLORS = ['#e6e6e6', '#f2c14e', '#c78ae0', '#4ea1f2']

const UP = '#e0342f', DOWN = '#1a9c5d' // A股配色: 红涨绿跌
const GRID = 'rgba(128,128,128,0.14)'
const AXIS = 'rgba(128,128,128,0.75)'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const loading = ref(false)
const error = ref('')
const kind = ref<'ohlc' | 'nav'>('ohlc')
const allBars = ref<KlineBar[]>([])
const hover = ref<number | null>(null) // 可见序列内的索引
let loadedFor = ''

/** 按周期+区间取可见数据 */
const visible = computed(() => allBars.value.slice(-rangeCount.value))

/** MA 计算: 对可见序列逐点算 (前段不足回看全量数据, 保证窗口起点也有 MA) */
function maOf(idx: number, p: number): number | null {
  const arr = allBars.value
  const gi = arr.length - visible.value.length + idx // 全量索引
  if (gi + 1 < p) return null
  let sum = 0
  for (let k = gi - p + 1; k <= gi; k++) sum += arr[k].close
  return sum / p
}
const maRows = computed(() => {
  const idx = hover.value != null ? hover.value : visible.value.length - 1
  return MA_PERIODS.map(p => ({ p, v: maOf(idx, p) }))
})

/** 请求缓存: symbol+period 维度 */
const cache = new Map<string, { kind: 'ohlc' | 'nav'; bars: KlineBar[] }>()

async function load(): Promise<void> {
  if (!/^\d{6}$/.test(props.symbol)) { error.value = '仅支持 A股/基金代码'; return }
  const key = `${props.symbol}:${period.value}`
  const hit = cache.get(key)
  if (hit) {
    kind.value = hit.kind
    allBars.value = hit.bars
    draw()
    return
  }
  loading.value = true
  error.value = ''
  try {
    const r = await api.get<{ kind: 'ohlc' | 'nav'; bars: KlineBar[] }>(`/api/market/kline?symbol=${props.symbol}&period=${period.value}`)
    cache.set(key, { kind: r.kind || 'ohlc', bars: r.bars || [] })
    kind.value = r.kind || 'ohlc'
    allBars.value = r.bars || []
    draw()
  } catch (e) {
    error.value = (e as Error).message || 'K线加载失败'
  } finally {
    loading.value = false
  }
}

function switchPeriod(p: Period): void {
  if (period.value === p) return
  period.value = p
}

function fmtVol(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万'
  return String(v)
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || allBars.value.length === 0) return
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || 320
  const cssH = props.height
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, cssW, cssH)

  const data = visible.value
  if (data.length < 2) return
  const isNav = kind.value === 'nav'

  // 布局: 主图 (价格/蜡烛/MA) 72% + 间隔 8px + 成交量副图 28%-8px (nav 无副图)
  const padL = 6, padR = 56, padT = 4, padB = 16
  const plotW = cssW - padL - padR
  const volH = isNav ? 0 : Math.max(36, Math.round((cssH - padT - padB) * 0.26))
  const gap = isNav ? 0 : 8
  const mainH = cssH - padT - padB - volH - gap
  const mainT = padT
  const volT = padT + mainH + gap

  // 价格范围 (含 MA, 保证均线在图内)
  let lo = Infinity, hi = -Infinity
  for (const b of data) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high }
  if (!isNav) {
    for (let i = 0; i < data.length; i++) {
      for (const p of MA_PERIODS) {
        const v = maOf(i, p)
        if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v }
      }
    }
  }
  const span0 = hi - lo || hi * 0.01 || 1
  lo -= span0 * 0.05; hi += span0 * 0.05
  const yOf = (v: number) => mainT + ((hi - v) / (hi - lo)) * mainH
  const step = plotW / data.length
  const bodyW = Math.max(1, Math.min(12, step * 0.7))

  // --- 网格 + 价格轴 ---
  ctx.font = '10px ui-sans-serif, system-ui'
  ctx.textBaseline = 'middle'
  const gridN = 4
  for (let i = 0; i <= gridN; i++) {
    const v = lo + ((hi - lo) * i) / gridN
    const y = yOf(v)
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke()
    ctx.fillStyle = AXIS
    ctx.textAlign = 'left'
    ctx.fillText(fmtPrice(v), padL + plotW + 4, y)
  }

  // --- 最新价虚线 + 右侧标签 (取可见区间最后一根收盘) ---
  const lastBar = data[data.length - 1]
  const lastY = yOf(lastBar.close)
  const lastUp = lastBar.close >= lastBar.open
  ctx.save()
  ctx.setLineDash([4, 3])
  ctx.strokeStyle = lastUp ? UP : DOWN
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(padL, lastY); ctx.lineTo(padL + plotW, lastY); ctx.stroke()
  ctx.restore()
  ctx.fillStyle = lastUp ? UP : DOWN
  ctx.fillRect(padL + plotW, lastY - 7, padR - 2, 14)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'left'
  ctx.fillText(fmtPrice(lastBar.close), padL + plotW + 4, lastY)

  // --- 蜡烛 ---
  data.forEach((b, i) => {
    const x = padL + i * step + step / 2
    const up = b.close >= b.open
    const color = up ? UP : DOWN
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1
    if (!isNav) {
      ctx.beginPath(); ctx.moveTo(x, yOf(b.high)); ctx.lineTo(x, yOf(b.low)); ctx.stroke()
    }
    const yO = yOf(b.open), yC = yOf(b.close)
    ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)))
  })

  // --- MA 均线 ---
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

  // --- 成交量副图 ---
  if (!isNav && volH > 0) {
    let vMax = 0
    for (const b of data) if (b.volume > vMax) vMax = b.volume
    if (vMax <= 0) vMax = 1
    const yVolOf = (v: number) => volT + volH - (v / vMax) * (volH - 4)
    // 副图基线 + 量轴
    ctx.strokeStyle = GRID
    ctx.beginPath(); ctx.moveTo(padL, volT + volH); ctx.lineTo(padL + plotW, volT + volH); ctx.stroke()
    ctx.fillStyle = AXIS
    ctx.textAlign = 'left'
    ctx.fillText(fmtVol(vMax), padL + plotW + 4, volT + 4)
    data.forEach((b, i) => {
      const x = padL + i * step + step / 2
      const up = b.close >= b.open
      ctx.fillStyle = up ? UP : DOWN
      const y = yVolOf(b.volume)
      ctx.fillRect(x - bodyW / 2, y, bodyW, volT + volH - y)
    })
  }

  // --- 日期轴 (首/中/末) ---
  ctx.fillStyle = AXIS
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const tick = (d: string) => (period.value === 'month' ? d.slice(0, 7) : d.slice(5))
  const labels: Array<[number, string]> = [
    [padL + 14, tick(data[0].date)],
    [padL + plotW / 2, tick(data[Math.floor(data.length / 2)].date)],
    [padL + plotW - 14, tick(lastBar.date)]
  ]
  for (const [x, t] of labels) ctx.fillText(t, x, cssH - 4)

  // --- 十字光标 + 信息浮层 ---
  if (hover.value != null) {
    const i = hover.value
    const b = data[i]
    const cx = padL + i * step + step / 2
    ctx.save()
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(120,120,120,0.5)'
    ctx.beginPath(); ctx.moveTo(cx, mainT); ctx.lineTo(cx, isNav ? mainT + mainH : volT + volH); ctx.stroke()
    // 水平线跟价格 (仅主图)
    const cy = yOf(b.close)
    ctx.beginPath(); ctx.moveTo(padL, cy); ctx.lineTo(padL + plotW, cy); ctx.stroke()
    ctx.restore()
    // 日期气泡 (底部)
    const label = b.date
    ctx.font = '10px ui-sans-serif, system-ui'
    const tw = ctx.measureText(label).width + 8
    ctx.fillStyle = 'rgba(60,60,60,0.9)'
    ctx.fillRect(Math.min(Math.max(cx - tw / 2, padL), padL + plotW - tw), cssH - 14, tw, 12)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.fillText(label, Math.min(Math.max(cx, padL + tw / 2), padL + plotW - tw / 2), cssH - 4)
    // OHLC 信息 (左上角)
    const prev = i > 0 ? data[i - 1] : null
    const chg = prev ? ((b.close - prev.close) / prev.close) * 100 : null
    const lines = [
      b.date,
      `开 ${b.open}  高 ${b.high}`,
      `低 ${b.low}  收 ${b.close}` + (chg != null ? `  ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : ''),
      isNav ? '' : `量 ${fmtVol(b.volume)}  振 ${(((b.high - b.low) / prev!.close) * 100).toFixed(2)}%`
    ].filter(Boolean)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
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

function fmtPrice(v: number): string {
  return v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(3)
}

function onMove(ev: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas || visible.value.length < 2) return
  const rect = canvas.getBoundingClientRect()
  const x = ev.clientX - rect.left
  const padL = 6, padR = 56
  const plotW = rect.width - padL - padR
  const data = visible.value
  const idx = Math.floor(((x - padL) / plotW) * data.length)
  hover.value = idx >= 0 && idx < data.length ? idx : null
  draw()
}

let ro: ResizeObserver | null = null
onMounted(() => {
  load()
  ro = new ResizeObserver(() => { if (allBars.value.length > 0) draw() })
  if (canvasRef.value) ro.observe(canvasRef.value)
})
onBeforeUnmount(() => { ro?.disconnect() })

watch(() => props.symbol, () => {
  allBars.value = []
  hover.value = null
  load()
})
watch(period, () => { hover.value = null; load() })
watch(range, () => { hover.value = null; draw() })
</script>
