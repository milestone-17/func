<template>
  <transition name="fade">
    <div v-if="modelValue" class="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" @click.self="onCancel">
      <div class="card w-full max-w-sm p-5 shadow-float">
        <h3 class="text-base font-semibold text-ink mb-1.5">{{ title }}</h3>
        <p v-if="message" class="text-sm text-ink2 mb-4 whitespace-pre-line">{{ message }}</p>
        <div class="flex gap-2 justify-end">
          <button class="btn-ghost" @click="onCancel">{{ cancelText || '取消' }}</button>
          <button class="btn-danger" @click="onConfirm">{{ confirmText || '确认' }}</button>
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
