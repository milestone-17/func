<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <!-- 三档周线徽章 (失败/不支持时不显示, 避免与状态文案混淆) -->
    <template v-if="!row.error && !row.unsupported">
      <span v-for="s in row.statuses" :key="s.period"
        :class="['rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                 s.position === 'above' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                 : s.position === 'below' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                 : 'bg-surface2 text-ink3']">
        {{ s.period }}周{{ s.position === 'above' ? '线上' : s.position === 'below' ? '线下' : '数据不足' }}
      </span>
    </template>

    <!-- 代码形态不支持 (如港股) -->
    <span v-if="row.unsupported" class="rounded-md bg-surface2 px-1.5 py-0.5 text-[10px] text-ink3">周线·暂不支持</span>

    <!-- 拉取失败 + 单只重试 -->
    <template v-if="row.error">
      <span class="rounded-md bg-rose-50 dark:bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">周线·拉取失败</span>
      <button @click="$emit('retry')" class="text-[10px] font-medium text-brand hover:underline">重试</button>
    </template>

    <span class="ml-auto text-[10px] text-ink3">周线截至 {{ dateStr }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WeekMaRow } from '@/lib/weekMa'

const props = defineProps<{ row: WeekMaRow }>()
defineEmits<{ retry: [] }>()

const dateStr = computed(() => new Date(props.row.fetchedAt).toISOString().slice(0, 10))
</script>
