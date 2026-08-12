<template>
  <div class="card card-pad fade-in">
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium text-ink2">{{ label }}</span>
      <slot name="badge" />
    </div>
    <div class="mt-1.5 money text-[1.7rem] font-bold leading-tight tracking-tight" :class="valueClass">
      <span v-if="prefix" :class="prefixClass" class="text-base font-semibold mr-0.5">{{ prefix }}</span>{{ value }}
    </div>
    <div v-if="sub" class="mt-1 text-xs" :class="subClass">{{ sub }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  value: string
  tone?: 'up' | 'down' | 'neutral'
  prefix?: string
  sub?: string
  subTone?: 'up' | 'down' | 'neutral' | 'muted'
}>()

const valueClass = computed(() => {
  switch (props.tone ?? 'neutral') {
    case 'up': return 'text-pos'
    case 'down': return 'text-neg'
    default: return 'text-ink'
  }
})
const prefixClass = computed(() => (props.tone === 'up' ? 'text-pos' : props.tone === 'down' ? 'text-neg' : 'text-ink2'))

const subClass = computed(() => {
  switch (props.subTone ?? 'muted') {
    case 'up': return 'text-pos'
    case 'down': return 'text-neg'
    case 'neutral': return 'text-ink2'
    default: return 'text-ink3'
  }
})
</script>
