<template>
  <span :class="badgeClass" class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-4 whitespace-nowrap">
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ tone?: 'green' | 'red' | 'amber' | 'blue' | 'gray' }>()

const badgeClass = computed(() => {
  switch (props.tone ?? 'gray') {
    case 'green': return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    case 'red': return 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
    case 'amber': return 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
    case 'blue': return 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
    default: return 'bg-surface2 text-ink2 dark:bg-surface2 dark:text-ink3'
  }
})
</script>
