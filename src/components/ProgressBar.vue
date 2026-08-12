<template>
  <div>
    <div class="flex items-center justify-between mb-1.5">
      <span class="text-sm text-ink2 flex items-center gap-1.5">
        <span v-if="color" class="h-2.5 w-2.5 rounded-full shrink-0" :style="{ backgroundColor: color }" />
        {{ label }}
      </span>
      <span class="money text-sm font-semibold text-ink">{{ value }}</span>
    </div>
    <div class="h-2 rounded-full bg-surface2 overflow-hidden">
      <div
        class="h-full rounded-full transition-[width] duration-500 ease-out"
        :style="{ width: pct + '%', backgroundColor: color || '#10b981' }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ label: string; value: string; percent: number; color?: string }>()

const pct = computed(() => Math.max(0, Math.min(100, props.percent)))
</script>
