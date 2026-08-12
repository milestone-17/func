<template>
  <section class="card card-pad space-y-3">
    <div class="flex items-center justify-between">
      <span class="section-title">应用锁</span>
      <Badge v-if="lock.hasPassword" tone="green">已开启</Badge>
      <Badge v-else tone="gray">未开启</Badge>
    </div>

    <!-- 已开启: 操作 -->
    <template v-if="lock.hasPassword && mode === 'idle'">
      <p class="text-xs text-ink3">每次打开 App 需输入 6 位数字密码解锁。</p>
      <button @click="lockNow" class="btn-ghost w-full">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        立即锁定
      </button>
      <button @click="mode = 'change'" class="btn-ghost w-full">修改密码</button>
      <button @click="mode = 'disable'" class="btn-ghost w-full !text-neg">关闭应用锁</button>
    </template>

    <!-- 未开启: 开启 -->
    <template v-else-if="!lock.hasPassword && mode === 'idle'">
      <p class="text-xs text-ink3">为应用设置一道密码,防止他人打开后误操作。</p>
      <button @click="mode = 'enable'" class="btn-primary w-full">开启应用锁</button>
    </template>

    <!-- 开启表单 -->
    <template v-else-if="mode === 'enable'">
      <div>
        <label class="label">设置 6 位数字密码</label>
        <input v-model="pw1" type="tel" inputmode="numeric" maxlength="6" placeholder="······" class="input money tracking-[0.5em] text-center text-lg" />
      </div>
      <div>
        <label class="label">确认密码</label>
        <input v-model="pw2" type="tel" inputmode="numeric" maxlength="6" placeholder="······" class="input money tracking-[0.5em] text-center text-lg" />
      </div>
      <div v-if="msg" class="text-xs" :class="ok ? 'text-pos' : 'text-neg'">{{ msg }}</div>
      <div class="flex gap-2">
        <button @click="cancel" class="btn-ghost flex-1">取消</button>
        <button @click="doEnable" class="btn-primary flex-1">确认开启</button>
      </div>
    </template>

    <!-- 修改密码表单 -->
    <template v-else-if="mode === 'change'">
      <div>
        <label class="label">当前密码</label>
        <input v-model="pwOld" type="tel" inputmode="numeric" maxlength="6" placeholder="······" class="input money tracking-[0.5em] text-center text-lg" />
      </div>
      <div>
        <label class="label">新密码</label>
        <input v-model="pw1" type="tel" inputmode="numeric" maxlength="6" placeholder="······" class="input money tracking-[0.5em] text-center text-lg" />
      </div>
      <div>
        <label class="label">确认新密码</label>
        <input v-model="pw2" type="tel" inputmode="numeric" maxlength="6" placeholder="······" class="input money tracking-[0.5em] text-center text-lg" />
      </div>
      <div v-if="msg" class="text-xs" :class="ok ? 'text-pos' : 'text-neg'">{{ msg }}</div>
      <div class="flex gap-2">
        <button @click="cancel" class="btn-ghost flex-1">取消</button>
        <button @click="doChange" class="btn-primary flex-1">确认修改</button>
      </div>
    </template>

    <!-- 关闭表单 -->
    <template v-else-if="mode === 'disable'">
      <div>
        <label class="label">输入当前密码以关闭</label>
        <input v-model="pwOld" type="tel" inputmode="numeric" maxlength="6" placeholder="······" class="input money tracking-[0.5em] text-center text-lg" />
      </div>
      <div v-if="msg" class="text-xs text-neg">{{ msg }}</div>
      <div class="flex gap-2">
        <button @click="cancel" class="btn-ghost flex-1">取消</button>
        <button @click="doDisable" class="btn-danger flex-1">关闭应用锁</button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Badge from './Badge.vue'
import { useLockStore } from '@/stores/lock'

const lock = useLockStore()

const mode = ref<'idle' | 'enable' | 'change' | 'disable'>('idle')
const pw1 = ref('')
const pw2 = ref('')
const pwOld = ref('')
const msg = ref('')
const ok = ref(false)

function reset() {
  pw1.value = ''; pw2.value = ''; pwOld.value = ''; msg.value = ''; ok.value = false
}
function cancel() { reset(); mode.value = 'idle' }

function lockNow() {
  lock.lock()
  // 触发 App.vue 显示锁屏
  if (typeof location !== 'undefined') location.reload()
}

async function doEnable() {
  if (pw1.value.length !== 6 || !/^\d{6}$/.test(pw1.value)) { ok.value = false; msg.value = '密码须为 6 位数字'; return }
  if (pw1.value !== pw2.value) { ok.value = false; msg.value = '两次输入不一致'; return }
  await lock.setPassword(pw1.value)
  ok.value = true; msg.value = '✓ 应用锁已开启'
  setTimeout(() => cancel(), 800)
}

async function doChange() {
  if (pw1.value.length !== 6 || !/^\d{6}$/.test(pw1.value)) { ok.value = false; msg.value = '新密码须为 6 位数字'; return }
  if (pw1.value !== pw2.value) { ok.value = false; msg.value = '两次输入不一致'; return }
  const r = await lock.changePassword(pwOld.value, pw1.value)
  if (!r) { ok.value = false; msg.value = '当前密码错误'; return }
  ok.value = true; msg.value = '✓ 密码已修改'
  setTimeout(() => cancel(), 800)
}

async function doDisable() {
  const r = await lock.disablePassword(pwOld.value)
  if (!r) { msg.value = '当前密码错误'; return }
  cancel()
}
</script>
