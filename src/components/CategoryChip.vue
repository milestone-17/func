<template>
  <div class="category-chip inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white" :style="{ backgroundColor: color }">
    <span>{{ name }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{ name: string; color: string }>()
</script>
