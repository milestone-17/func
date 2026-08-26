<template>
  <div class="w-full" style="height: 320px">
    <Line v-if="chartData" :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend
} from 'chart.js'
import type { Channel, MonthlyBar } from '@/lib/indexChannel'

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend)

const props = defineProps<{ bars: MonthlyBar[]; channel: Channel }>()

/** 数据集构造: n 月数组, 区间外为 null (chart.js spanGaps=false 断开) */
function seriesOf(n: number, fromT: number, toT: number, valueAt: (t: number) => number): (number | null)[] {
  const out: (number | null)[] = []
  for (let t = 0; t < n; t++) out.push(t >= fromT && t <= toT ? valueAt(t) : null)
  return out
}

const chartData = computed(() => {
  const { bars, channel } = props
  const n = bars.length
  const midFrom = Math.max(channel.top.fromT, channel.bottom.fromT)
  return {
    labels: bars.map(b => b.date.slice(0, 7)),
    datasets: [
      {
        label: '月收盘',
        data: bars.map(b => b.close),
        borderColor: '#10b981', backgroundColor: '#10b981',
        pointRadius: 0, pointHoverRadius: 3, borderWidth: 1.6, tension: 0.15, spanGaps: true
      },
      {
        label: '顶线',
        data: seriesOf(n, channel.top.fromT, channel.top.toT, t => channel.top.slope * t + channel.top.intercept),
        borderColor: '#f43f5e', backgroundColor: '#f43f5e',
        pointRadius: 0, borderWidth: 1.8, tension: 0, spanGaps: false
      },
      {
        label: '低线',
        data: seriesOf(n, channel.bottom.fromT, channel.bottom.toT, t => channel.bottom.slope * t + channel.bottom.intercept),
        borderColor: '#f59e0b', backgroundColor: '#f59e0b',
        pointRadius: 0, borderWidth: 1.8, tension: 0, spanGaps: false
      },
      {
        label: '中线',
        data: seriesOf(n, midFrom, channel.top.toT, t =>
          (channel.top.slope * t + channel.top.intercept + channel.bottom.slope * t + channel.bottom.intercept) / 2),
        borderColor: '#94a3b8', backgroundColor: '#94a3b8',
        pointRadius: 0, borderWidth: 1.2, borderDash: [4, 4], tension: 0, spanGaps: false
      },
      {
        label: '避雷针(已剔除)',
        data: seriesOf(n, 0, n - 1, t => channel.excludedSpikes.find(s => s.t === t)?.value ?? Number.NaN)
          .map(v => (v != null && Number.isNaN(v as number) ? null : v)),
        borderColor: '#f43f5e', backgroundColor: '#f43f5e',
        showLine: false, pointRadius: 5, pointStyle: 'triangle', spanGaps: false
      }
    ]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { intersect: false, mode: 'index' as const },
  scales: {
    x: {
      ticks: { maxTicksLimit: 8, color: '#94a3b8', font: { size: 10 }, maxRotation: 0, autoSkip: true },
      grid: { display: false },
      border: { display: false }
    },
    y: {
      ticks: { maxTicksLimit: 5, color: '#94a3b8', font: { size: 10 } },
      grid: { color: 'rgba(120,120,150,0.09)' },
      border: { display: false }
    }
  },
  plugins: {
    legend: {
      position: 'top' as const,
      align: 'end' as const,
      labels: { boxWidth: 14, boxHeight: 2, font: { size: 11 }, color: '#94a3b8', usePointStyle: true, pointStyleWidth: 10 }
    },
    tooltip: { backgroundColor: 'rgba(15,23,42,0.92)', padding: 9, titleFont: { size: 11 }, bodyFont: { size: 12 } }
  }
}
</script>
