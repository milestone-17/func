<template>
  <div class="pie-chart-wrap">
    <Pie v-if="chartData" :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Pie } from 'vue-chartjs'
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js'
import { formatYuan } from '@/lib/money'

ChartJS.register(ArcElement, Tooltip, Legend)

const props = defineProps<{ labels: string[]; values: number[]; colors?: string[] }>()

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [{
    data: props.values.map(v => v / 100),
    backgroundColor: props.colors || ['#60a5fa', '#f87171', '#fbbf24', '#34d399', '#a78bfa', '#fb923c']
  }]
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.label}: ¥${formatYuan(Math.round(ctx.parsed * 100))}`
      }
    }
  }
}
</script>

<style scoped>
.pie-chart-wrap { height: 220px; }
</style>
