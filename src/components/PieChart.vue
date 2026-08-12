<template>
  <div class="flex items-center gap-4">
    <div class="w-full" :style="{ height: height + 'px' }" :class="chartFlex">
      <component :is="Doughnut" v-if="chartData && doughnut" :data="chartData" :options="chartOptions" />
      <Pie v-else-if="chartData" :data="chartData" :options="chartOptions" />
    </div>
    <div v-if="showLegend" class="space-y-2 shrink-0 min-w-0 flex-1">
      <div v-for="(l, i) in labels" :key="l" class="flex items-center gap-2 text-xs">
        <span class="h-2.5 w-2.5 rounded-full shrink-0" :style="{ backgroundColor: colors[i % colors.length] }" />
        <span class="text-ink2 truncate">{{ l }}</span>
        <span class="ml-auto money font-semibold text-ink">{{ values[i] ? formatYuan(values[i]) : '—' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Pie, Doughnut } from 'vue-chartjs'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { formatYuan } from '@/lib/money'

ChartJS.register(ArcElement, Tooltip, Legend)

const props = withDefaults(defineProps<{
  labels: string[]
  values: number[]            // 单位: 分
  colors?: string[]
  height?: number
  doughnut?: boolean
  showLegend?: boolean
}>(), { height: 220, doughnut: false, showLegend: false })

const PALETTE = ['#10b981', '#6366f1', '#f59e0b', '#38bdf8', '#f472b6', '#a3e635', '#fb923c', '#2dd4bf']
const colors = computed(() => props.colors && props.colors.length ? props.colors : PALETTE)

const chartFlex = computed(() => (props.showLegend ? 'max-w-[46%]' : 'w-full'))

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [{
    data: props.values.map(v => v / 100),
    backgroundColor: colors.value,
    borderColor: 'rgba(255,255,255,0)',
    borderWidth: 2,
    hoverOffset: 6
  }]
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: props.doughnut ? '58%' : undefined,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(15,23,42,0.92)',
      padding: 9,
      bodyFont: { size: 12 },
      displayColors: false,
      callbacks: {
        label: (ctx: any) => `¥${formatYuan(Math.round(ctx.parsed * 100))}`
      }
    }
  }
}
</script>
