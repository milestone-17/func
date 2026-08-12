<template>
  <input
    :value="modelValue"
    @input="onInput"
    type="date"
    :max="max"
    :min="min"
    class="input !w-auto !py-1.5 !text-sm"
  />
</template>

<script setup lang="ts">
defineProps<{ modelValue: string; min?: string; max?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
function onInput(e: Event) { emit('update:modelValue', (e.target as HTMLInputElement).value) }
</script>
