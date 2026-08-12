<template>
  <transition name="fade">
    <div v-if="modelValue" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" @click.self="onCancel">
      <div class="bg-white rounded-lg p-5 max-w-sm w-full">
        <h3 class="text-lg font-semibold mb-2">{{ title }}</h3>
        <p v-if="message" class="text-gray-600 mb-4 whitespace-pre-line">{{ message }}</p>
        <div class="flex gap-2 justify-end">
          <button class="px-4 py-2 text-gray-600" @click="onCancel">{{ cancelText || '取消' }}</button>
          <button class="px-4 py-2 bg-red-500 text-white rounded-lg" @click="onConfirm">{{ confirmText || '确认' }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  confirm: []
  cancel: []
}>()

function onCancel() { emit('update:modelValue', false); emit('cancel') }
function onConfirm() { emit('update:modelValue', false); emit('confirm') }
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
