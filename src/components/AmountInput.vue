<template>
  <div class="amount-input">
    <label v-if="label" class="label">{{ label }}</label>
    <div class="flex items-center gap-1 rounded-xl border border-line bg-surface px-3 transition focus-within:ring-2 focus-within:ring-brand/25 focus-within:border-brand/60">
      <span class="text-ink3 font-medium">¥</span>
      <input
        :value="displayValue"
        @input="onInput"
        type="text"
        inputmode="decimal"
        :placeholder="placeholder || '0.00'"
        class="money w-full min-w-0 flex-1 py-2 text-right text-lg font-semibold bg-transparent text-ink placeholder:text-ink3 focus:outline-none"
      />
    </div>
    <div v-if="error" class="mt-1 text-xs text-neg">{{ error }}</div>
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
