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

const props = withDefaults(defineProps<{
  labels: string[]
  values: number[]            // 单位: 分
  label?: string
  color?: string
  height?: number
}>(), { height: 220 })

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [{
    label: props.label || '金额',
    data: props.values.map(v => v / 100),
    backgroundColor: props.color || '#10b981',
    borderRadius: 5,
    borderSkipped: false,
    maxBarThickness: 26
  }]
}))

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
      ticks: { maxTicksLimit: 4, color: '#94a3b8', font: { size: 10 } },
      grid: { color: 'rgba(120,120,150,0.09)' },
      border: { display: false }
    }
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(15,23,42,0.92)',
      padding: 9,
      bodyFont: { size: 12 },
      displayColors: false,
      callbacks: {
        label: (ctx: any) => `¥${formatYuan(Math.round(ctx.parsed.y * 100))}`
      }
    }
  }
}
</script>
