<template>
  <div class="amount-input">
    <label v-if="label" class="block text-sm text-gray-600 mb-1">{{ label }}</label>
    <div class="flex items-center gap-2">
      <span class="text-gray-500">¥</span>
      <input
        :value="displayValue"
        @input="onInput"
        type="text"
        inputmode="decimal"
        :placeholder="placeholder || '0.00'"
        class="flex-1 px-3 py-2 border rounded-lg text-right text-lg font-mono"
      />
    </div>
    <div v-if="error" class="text-red-500 text-xs mt-1">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { yuanToFen, fenToYuan } from '@/lib/money'

const props = defineProps<{
  modelValue: number | null
  label?: string
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [v: number | null] }>()

const error = ref<string | null>(null)
const text = ref<string>(props.modelValue != null ? String(fenToYuan(props.modelValue)) : '')

const displayValue = computed(() => text.value)

function onInput(e: Event) {
  const t = (e.target as HTMLInputElement).value
  text.value = t
  if (t === '' || t === '.') {
    emit('update:modelValue', null)
    error.value = null
    return
  }
  const v = Number(t)
  if (Number.isNaN(v) || v < 0) {
    error.value = '请输入合法数字'
    return
  }
  error.value = null
  emit('update:modelValue', yuanToFen(v))
}
</script>
