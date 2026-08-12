<template>
  <div :class="['rounded-lg border p-3', exceeds ? 'border-red-400 bg-red-50' : 'border-gray-200']">
    <div class="flex items-center justify-between">
      <div>
        <div class="text-sm text-gray-500">第 {{ weekIndex }} 周 · 分扣 ¥{{ split }}</div>
        <div class="text-xs mt-1">
          偏离 <span :class="devClass">{{ deviation.toFixed(2) }}%</span> ·
          档位 <strong>{{ bucket.label }}</strong>
        </div>
      </div>
      <div class="text-right">
        <div class="text-xs text-gray-500">建议金额</div>
        <div class="text-xl font-semibold" :class="exceeds ? 'text-red-600' : 'text-blue-600'">¥{{ suggested.toFixed(2) }}</div>
      </div>
    </div>
    <div v-if="exceeds" class="mt-2 text-xs text-red-600">
      ⚠ 已超过本周基础额,确认执行?
      <div class="flex gap-2 mt-2">
        <button class="px-2 py-1 border rounded" @click="$emit('skip')">跳过</button>
        <button class="px-2 py-1 bg-red-500 text-white rounded" @click="$emit('confirm')">仍按建议投</button>
      </div>
    </div>
    <div v-else class="mt-2 flex gap-2">
      <button class="px-3 py-1 bg-blue-500 text-white rounded text-sm" @click="$emit('confirm')">按建议投</button>
      <button class="px-3 py-1 border rounded text-sm" @click="$emit('skip')">跳过</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  weekIndex: 1 | 2 | 3 | 4
  split: number
  deviation: number
  bucket: { label: string; side: string; rate: number }
  suggested: number
  exceeds: boolean
}>()
defineEmits<{ confirm: []; skip: [] }>()

const devClass = computed(() => {
  if (props.deviation > 0) return 'text-red-500'
  if (props.deviation < 0) return 'text-green-600'
  return 'text-gray-500'
})
</script>
