<template>
  <div class="w-full" :style="{ height: height + 'px' }">
    <Line v-if="chartData" :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend
} from 'chart.js'

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend)

export interface LineSeries {
  label: string
  data: (number | null)[]
  color?: string
  fill?: boolean
}

const props = withDefaults(defineProps<{
  labels: string[]
  series: LineSeries[]
  height?: number
}>(), { height: 220 })

const chartData = computed(() => ({
  labels: props.labels,
  datasets: props.series.map(s => ({
    label: s.label,
    data: s.data,
    borderColor: s.color || '#10b981',
    backgroundColor: s.fill ? (s.color || '#10b981') : (s.color || '#10b981'),
    pointRadius: 0,
    pointHoverRadius: 3,
    borderWidth: 1.8,
    tension: 0.3,
    fill: !!s.fill,
    spanGaps: true
  }))
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { intersect: false, mode: 'index' as const },
  scales: {
    x: {
      ticks: { maxTicksLimit: 6, color: '#94a3b8', font: { size: 10 } },
      grid: { display: false },
      border: { display: false }
    },
    y: {
      ticks: { maxTicksLimit: 4, color: '#94a3b8', font: { size: 10 } },
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
    tooltip: {
      backgroundColor: 'rgba(15,23,42,0.92)',
      padding: 9,
      titleFont: { size: 11 },
      bodyFont: { size: 12 },
      displayColors: true,
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)}`
      }
    }
  }
}
</script>
