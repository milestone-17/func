<template>
  <div class="bar-chart-wrap">
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

const props = defineProps<{ labels: string[]; values: number[]; label?: string; color?: string }>()

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [{
    label: props.label || '金额',
    data: props.values.map(v => v / 100),
    backgroundColor: props.color || '#60a5fa'
  }]
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ¥${formatYuan(Math.round(ctx.parsed.y * 100))}`
      }
    }
  }
}
</script>

<style scoped>
.bar-chart-wrap { height: 200px; }
</style>
