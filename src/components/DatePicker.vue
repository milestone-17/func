<template>
  <input
    :value="modelValue"
    @input="onInput"
    type="date"
    :max="max"
    :min="min"
    class="px-3 py-2 border rounded-lg"
  />
</template>

<script setup lang="ts">
defineProps<{ modelValue: string; min?: string; max?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
function onInput(e: Event) { emit('update:modelValue', (e.target as HTMLInputElement).value) }
</script>
