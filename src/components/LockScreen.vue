<template>
  <div class="min-h-screen bg-canvas flex flex-col items-center justify-center px-6">
    <div class="w-full max-w-xs text-center">
      <!-- 品牌标识 -->
      <div class="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand text-white text-2xl font-bold shadow-float">¥</div>
      <h1 class="mt-4 text-xl font-bold tracking-tight">本地财务</h1>
      <p class="mt-1 text-sm text-ink3">输入密码解锁</p>

      <!-- 密码输入 -->
      <form @submit.prevent="onUnlock" class="mt-6 space-y-3">
        <div class="flex items-center justify-center gap-2.5">
          <input
            v-for="i in 6"
            :key="i"
            :ref="el => { if (el) inputs[i - 1] = el as HTMLInputElement }"
            v-model="digits[i - 1]"
            type="tel"
            inputmode="numeric"
            maxlength="1"
            autocomplete="off"
            @input="onInput(i - 1)"
            @keydown.delete="onBackspace(i - 1)"
            class="h-14 w-11 rounded-xl border-2 bg-surface text-center text-2xl font-bold money transition focus:outline-none"
            :class="error ? 'border-neg' : (digits[i-1] ? 'border-brand' : 'border-line')"
            :aria-label="`第${i}位`"
          />
        </div>
        <div v-if="error" class="text-sm text-neg">密码错误,请重试</div>
        <button type="submit" :disabled="!filled" class="btn-primary w-full !py-3 disabled:opacity-40">解锁</button>
      </form>

      <!-- 忘记密码 -->
      <button @click="askReset = true" class="mt-5 text-xs text-ink3 underline-offset-2 hover:text-neg hover:underline">
        忘记密码?
      </button>
    </div>

    <!-- 紧急重置确认 -->
    <div v-if="askReset" class="sheet items-center" @click.self="askReset = false">
      <div class="card w-full max-w-xs p-5 shadow-float">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-neg/12 text-neg mb-3">
          <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <h3 class="text-center font-semibold">清除全部数据?</h3>
        <p class="mt-1.5 text-center text-sm text-ink2">
          忘记密码无法找回。此操作将<b class="text-neg">永久删除</b>所有账本、持仓、定投记录,且不可恢复。
        </p>
        <p class="mt-1.5 text-center text-xs text-ink3">建议先回忆密码,或换设备从备份恢复。</p>
        <div class="mt-4 flex gap-2">
          <button @click="askReset = false" class="btn-ghost flex-1">取消</button>
          <button @click="doReset" class="btn-danger flex-1">确认清除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useLockStore } from '@/stores/lock'

const lock = useLockStore()

const digits = ref<string[]>(['', '', '', '', '', ''])
const inputs = ref<HTMLInputElement[]>([])
const error = ref(false)
const askReset = ref(false)

const filled = computed(() => digits.value.every(d => d !== ''))

function onInput(idx: number) {
  error.value = false
  const v = digits.value[idx]
  // 只保留数字
  if (v && !/^\d$/.test(v)) { digits.value[idx] = ''; return }
  // 自动跳到下一格
  if (v && idx < 5) nextTick(() => inputs.value[idx + 1]?.focus())
}

function onBackspace(idx: number) {
  // 当前格为空时, 回退到上一格
  if (!digits.value[idx] && idx > 0) {
    nextTick(() => {
      digits.value[idx - 1] = ''
      inputs.value[idx - 1]?.focus()
    })
  }
}

async function onUnlock() {
  if (!filled.value) return
  const pw = digits.value.join('')
  const ok = await lock.verify(pw)
  if (!ok) {
    error.value = true
    digits.value = ['', '', '', '', '', '']
    nextTick(() => inputs.value[0]?.focus())
  }
}

async function doReset() {
  askReset.value = false
  await lock.emergencyReset()
}
</script>
