<template>
  <div class="w-full">
    <div class="flex items-center gap-1 mb-1">
      <button v-for="opt in RANGES" :key="opt" @click="range = opt"
        :class="['rounded-md px-2 py-0.5 text-[11px] font-medium transition', range === opt ? 'bg-brand-soft text-brand' : 'text-ink3 hover:text-ink']">
        {{ opt }}
      </button>
      <span v-if="kind === 'nav'" class="ml-auto text-[10px] text-ink3">场外基金无盘口价 · 以净值绘蜡烛</span>
    </div>
    <div class="relative w-full" :style="{ height: height + 'px' }">
      <canvas ref="canvasRef" class="w-full h-full block" @mousemove="onMove" @mouseleave="hover = null"></canvas>
      <div v-if="loading" class="absolute inset-0 grid place-items-center text-xs text-ink3 bg-surface/60">K线加载中…</div>
      <div v-else-if="error" class="absolute inset-0 grid place-items-center text-xs text-neg bg-surface/60">{{ error }}</div>
      <!-- 悬停信息 -->
      <div v-else-if="hover" class="pointer-events-none absolute right-1 top-1 rounded-md bg-surface2/95 px-2 py-1 text-[10px] leading-4 text-ink">
        <div class="font-medium">{{ hover.bar.date }}</div>
        <div>开 {{ hover.bar.open }} 高 {{ hover.bar.high }}</div>
        <div>低 {{ hover.bar.low }} 收 <span :class="hover.bar.close >= hover.bar.open ? 'text-pos' : 'text-neg'">{{ hover.bar.close }}</span></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { api } from '@/lib/api'

export interface KlineBar { date: string; open: number; high: number; low: number; close: number }

const props = withDefaults(defineProps<{
  symbol: string
  height?: number
}>(), { height: 240 })

const RANGES = ['1月', '3月', '6月', '全部'] as const
type Range = typeof RANGES[number]
const range = ref<Range>('3月')
const rangeCount = computed(() => (range.value === '1月' ? 22 : range.value === '3月' ? 66 : range.value === '6月' ? 132 : 5000))

const canvasRef = ref<HTMLCanvasElement | null>(null)
const loading = ref(false)
const error = ref('')
const kind = ref<'ohlc' | 'nav'>('ohlc')
const bars = ref<KlineBar[]>([])
const hover = ref<{ bar: KlineBar; x: number } | null>(null)
let loadedFor = '' // 已加载的 symbol, 防重复请求

async function load(): Promise<void> {
  if (!/^\d{6}$/.test(props.symbol)) { error.value = '仅支持 A股/基金代码'; return }
  if (loadedFor === props.symbol && bars.value.length > 0) { draw(); return }
  loading.value = true
  error.value = ''
  try {
    const r = await api.get<{ kind: 'ohlc' | 'nav'; bars: KlineBar[] }>(`/api/market/kline?symbol=${props.symbol}`)
    bars.value = r.bars || []
    kind.value = r.kind || 'ohlc'
    loadedFor = props.symbol
    draw()
  } catch (e) {
    error.value = (e as Error).message || 'K线加载失败'
  } finally {
    loading.value = false
  }
}

const visible = computed(() => bars.value.slice(-rangeCount.value))

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || bars.value.length === 0) return
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
  const UP = '#e0342f', DOWN = '#1a9c5d' // A股配色: 红涨绿跌
  const padL = 6, padR = 52, padT = 6, padB = 18
  const plotW = cssW - padL - padR
  const plotH = cssH - padT - padB
  let lo = Infinity, hi = -Infinity
  for (const b of data) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high }
  const span = hi - lo || hi * 0.01 || 1
  lo -= span * 0.05; hi += span * 0.05
  const yOf = (v: number) => padT + ((hi - v) / (hi - lo)) * plotH
  const step = plotW / data.length
  const bodyW = Math.max(1, Math.min(10, step * 0.65))
  const isNav = kind.value === 'nav'

  // 网格 + 价格轴 (右侧 4 档)
  ctx.font = '10px ui-sans-serif, system-ui'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4
    const y = yOf(v)
    ctx.strokeStyle = 'rgba(128,128,128,0.14)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke()
    ctx.fillStyle = 'rgba(128,128,128,0.75)'
    ctx.fillText(v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 3), padL + plotW + 4, y)
  }

  // 蜡烛
  data.forEach((b, i) => {
    const x = padL + i * step + step / 2
    const up = b.close >= b.open
    const color = isNav ? (up ? UP : DOWN) : (up ? UP : DOWN)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1
    if (!isNav) {
      // 影线
      ctx.beginPath(); ctx.moveTo(x, yOf(b.high)); ctx.lineTo(x, yOf(b.low)); ctx.stroke()
    }
    // 实体
    const yO = yOf(b.open), yC = yOf(b.close)
    const top = Math.min(yO, yC)
    const h = Math.max(1, Math.abs(yC - yO))
    ctx.fillRect(x - bodyW / 2, top, bodyW, h)
  })

  // 日期轴 (首/中/末 3 个刻度)
  ctx.fillStyle = 'rgba(128,128,128,0.75)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const labels: Array<[number, string]> = [[padL + 14, data[0].date.slice(5)], [padL + plotW / 2, data[Math.floor(data.length / 2)].date.slice(5)], [padL + plotW - 14, data[data.length - 1].date.slice(5)]]
  for (const [x, t] of labels) ctx.fillText(t, x, cssH - 4)
}

function onMove(ev: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas || visible.value.length < 2) return
  const rect = canvas.getBoundingClientRect()
  const x = ev.clientX - rect.left
  const padL = 6, padR = 52
  const plotW = rect.width - padL - padR
  const data = visible.value
  const idx = Math.floor(((x - padL) / plotW) * data.length)
  if (idx < 0 || idx >= data.length) { hover.value = null; return }
  hover.value = { bar: data[idx], x }
  // 高亮十字线: 重绘 + 竖线
  draw()
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const step = plotW / data.length
  const cx = padL + idx * step + step / 2
  ctx.strokeStyle = 'rgba(120,120,120,0.45)'
  ctx.setLineDash([3, 3])
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, props.height - 18); ctx.stroke()
  ctx.setLineDash([])
}

let ro: ResizeObserver | null = null
onMounted(() => {
  load()
  ro = new ResizeObserver(() => { if (bars.value.length > 0) draw() })
  if (canvasRef.value) ro.observe(canvasRef.value)
})
onBeforeUnmount(() => { ro?.disconnect() })

watch(() => props.symbol, () => { loadedFor = ''; bars.value = []; load() })
watch(range, () => draw())
</script>
