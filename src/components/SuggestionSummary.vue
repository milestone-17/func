<template>
  <div v-if="lowest || highest" class="grid grid-cols-2 gap-3 sm:grid-cols-3">
    <!-- 最低估 -->
    <div v-if="lowest" class="card card-pad">
      <div class="text-xs font-medium text-ink2">最低估候选</div>
      <div class="mt-1 text-base font-bold text-ink truncate">{{ lowest.name }}</div>
      <div class="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
        分位 {{ lowest.percentile }} · {{ lowest.bucketLabel }}
      </div>
    </div>
    <!-- 最高估 -->
    <div v-if="highest" class="card card-pad">
      <div class="text-xs font-medium text-ink2">最高估回避</div>
      <div class="mt-1 text-base font-bold text-ink truncate">{{ highest.name }}</div>
      <div class="mt-0.5 text-xs text-rose-600 dark:text-rose-400 font-semibold tabular-nums">
        分位 {{ highest.percentile }} · {{ highest.bucketLabel }}
      </div>
    </div>
    <!-- 拉取时间 -->
    <div class="card card-pad col-span-2 sm:col-span-1">
      <div class="text-xs font-medium text-ink2">{{ staleDate ? '陈旧快照' : '最近拉取' }}</div>
      <div class="mt-1 text-base font-bold text-ink">
        {{ formatTime }}
      </div>
      <div v-if="staleDate" class="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
        ⚠ 数据来自 {{ staleDate }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ValuationRow } from '@/types/valuation'

const props = defineProps<{
  lowest: ValuationRow | null
  highest: ValuationRow | null
  lastFetchedAt: number | null
  staleDate: string | null
}>()

const formatTime = computed<string>(() => {
  if (props.staleDate) return props.staleDate
  if (props.lastFetchedAt) {
    const d = new Date(props.lastFetchedAt)
    const today = new Date().toISOString().slice(0, 10)
    const dateStr = d.toISOString().slice(0, 10)
    if (dateStr === today) {
      return d.toTimeString().slice(0, 5)
    }
    return dateStr
  }
  return '—'
})
</script>
