<template>
  <div class="w-full" :style="{ height: height + 'px' }">
    <Bar v-if="chartData" :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title
} from 'chart.js'
import { formatYuan } from '@/lib/money'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend, Title)

export interface BarSeries {
  label: string
  values: number[]          // 单位: 分
  color: string
}

const props = withDefaults(defineProps<{
  labels: string[]
  values?: number[]         // 单位: 分 (单数据集模式)
  series?: BarSeries[]      // 多数据集模式 (优先)
  label?: string
  color?: string
  height?: number
}>(), { height: 220 })

const chartData = computed(() => {
  if (props.series && props.series.length) {
    return {
      labels: props.labels,
      datasets: props.series.map(s => ({
        label: s.label,
        data: s.values.map(v => v / 100),
        backgroundColor: s.color,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 14
      }))
    }
  }
  return {
    labels: props.labels,
    datasets: [{
      label: props.label || '金额',
      data: (props.values || []).map(v => v / 100),
      backgroundColor: props.color || '#10b981',
      borderRadius: 5,
      borderSkipped: false,
      maxBarThickness: 26
    }]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      ticks: { color: '#94a3b8', font: { size: 10 } },
      grid: { display: false },
      border: { display: false }
    },
    y: {
      ticks: { maxTicksLimit: 4, color: '#94a3b8', font: { size: 10 }, callback: (v: any) => formatShort(v) },
      grid: { color: 'rgba(120,120,150,0.09)' },
      border: { display: false }
    }
  },
  plugins: {
    legend: {
      position: 'top' as const,
      align: 'end' as const,
      labels: { boxWidth: 12, boxHeight: 2, font: { size: 11 }, color: '#94a3b8', usePointStyle: true, pointStyleWidth: 8 }
    },
    tooltip: {
      backgroundColor: 'rgba(15,23,42,0.92)',
      padding: 9,
      bodyFont: { size: 12 },
      displayColors: true,
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ¥${formatYuan(Math.round(ctx.parsed.y * 100))}`
      }
    }
  }
}

function formatShort(yuan: number) {
  const a = Math.abs(yuan)
  if (a >= 10000) return (yuan / 10000).toFixed(1) + '万'
  return String(Math.round(yuan))
}
</script>
