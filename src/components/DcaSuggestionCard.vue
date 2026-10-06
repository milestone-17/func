<template>
  <div :class="['card card-pad fade-in transition-opacity',
    exceeds && status !== 'executed' ? 'ring-1 ring-neg/40' : '',
    status === 'executed' ? 'ring-1 ring-pos/50' : '',
    status === 'skipped' ? 'opacity-60' : '']">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="grid h-7 w-7 place-items-center rounded-full bg-surface2 text-xs font-bold text-ink2">{{ weekIndex }}</span>
          <span class="text-sm font-medium text-ink">第 {{ weekIndex }} 周</span>
          <Badge :tone="sideTone">{{ bucket.label }}</Badge>
          <span v-if="status === 'executed'" class="inline-flex items-center gap-0.5 rounded-full bg-pos/10 px-1.5 py-0.5 text-[10px] font-medium text-pos">✓ 已投入</span>
          <span v-else-if="status === 'skipped'" class="inline-flex items-center gap-0.5 rounded-full bg-surface2 px-1.5 py-0.5 text-[10px] font-medium text-ink3">已跳过</span>
        </div>
        <div class="mt-1.5 text-xs text-ink3">
          基础分扣 <span class="money text-ink2 font-medium">¥{{ split.toFixed(2) }}</span>
          · 系数 <span class="money font-semibold" :class="rateClass">×{{ bucket.rate.toFixed(1) }}</span>
        </div>
      </div>
      <div class="text-right shrink-0">
        <div class="text-[11px] text-ink3">建议投入</div>
        <div class="money text-2xl font-bold leading-tight" :class="exceeds ? 'text-neg' : 'text-brand'">¥{{ suggested.toFixed(0) }}</div>
      </div>
    </div>

    <!-- 金额条: 基础 vs 建议 -->
    <div class="mt-3">
      <div class="relative h-2 rounded-full bg-surface2 overflow-hidden">
        <div class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
             :style="{ width: baseWidth + '%', backgroundColor: 'rgb(var(--ink3))' }" />
        <div class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
             :style="{ width: suggestWidth + '%', backgroundColor: exceeds ? 'rgb(var(--neg))' : 'rgb(var(--brand))' }" />
      </div>
    </div>

    <template v-if="status === 'executed'">
      <div class="mt-3 flex items-center justify-between rounded-xl bg-pos/8 px-3 py-2 text-xs">
        <span class="text-pos font-medium">✓ 本周已投入{{ executedAmount ? ' ¥' + executedAmount.toFixed(0) : '' }}</span>
        <button class="text-ink3 hover:text-neg underline underline-offset-2" @click="$emit('undo')">撤销</button>
      </div>
    </template>
    <template v-else-if="status === 'skipped'">
      <div class="mt-3 flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-xs">
        <span class="text-ink3">本周已跳过</span>
        <button class="text-brand underline underline-offset-2" @click="$emit('undo')">撤销</button>
      </div>
    </template>
    <template v-else>
      <div v-if="exceeds" class="rounded-xl bg-neg/8 px-3 py-2 text-xs text-neg">
        ⚠ 当前处于高位,建议金额已超过基础分扣。
        <div class="mt-2 flex gap-2">
          <button class="btn-ghost !py-1 !text-xs flex-1" @click="$emit('skip')">本周跳过</button>
          <button class="btn-danger !py-1 !text-xs flex-1" @click="$emit('confirm')">仍按建议投</button>
        </div>
      </div>
      <div v-else class="flex gap-2">
        <button class="btn-primary flex-1" @click="$emit('confirm')">按建议投入</button>
        <button class="btn-ghost" @click="$emit('skip')">跳过</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Badge from './Badge.vue'

const props = defineProps<{
  weekIndex: 1 | 2 | 3 | 4
  split: number
  deviation: number
  bucket: { label: string; side: string; rate: number }
  suggested: number
  exceeds: boolean
  status?: 'none' | 'executed' | 'skipped'
  executedAmount?: number
}>()
defineEmits<{ confirm: []; skip: []; undo: [] }>()

const sideTone = computed<'green' | 'red' | 'amber' | 'blue'>(() => {
  if (props.bucket.side === 'high') return 'red'
  if (props.bucket.side === 'low') return 'green'
  return 'blue'
})
const rateClass = computed(() => (props.bucket.rate >= 1 ? 'text-pos' : 'text-neg'))

// 条形比例: 以"基础分扣"与"建议金额"中较大者为 100%
const baseWidth = computed(() => {
  const max = Math.max(props.split, props.suggested, 1)
  return Math.min(100, (props.split / max) * 100)
})
const suggestWidth = computed(() => {
  const max = Math.max(props.split, props.suggested, 1)
  return Math.min(100, (props.suggested / max) * 100)
})
</script>
