<script setup lang="ts">
/**
 * 通知提醒横幅 (两类):
 *   - 邮箱注册用户首次进入 → "已为你开启每日定投通知" 欢迎条 (可去设置修改/关闭)
 *   - guest 等无真实邮箱用户 → 原邮箱填写提醒 (三动作)
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useNotifyStore } from '@/stores/notify'
import {
  shouldShowPrompt, shouldShowWelcome, dismissForSession, dismissPermanently, markWelcomeSeen
} from '@/lib/notifyPrompt'

const router = useRouter()
const auth = useAuthStore()
const notify = useNotifyStore()

const visible = ref(false)
const welcome = ref(false) // true=邮箱用户欢迎条, false=填写提醒横幅

onMounted(async () => {
  if (!auth.isLoggedIn) return
  // 邮箱注册用户: 首次显示欢迎条 (不看通知配置, 关闭一次后不再显示)
  if (shouldShowWelcome({ user: auth.user })) {
    welcome.value = true
    visible.value = true
    return
  }
  // 其他用户: 原"填写邮箱提醒"逻辑
  let saved = false
  try {
    await notify.load()
    saved = !!notify.config?.notifyEmail && !/@guest\.local$/i.test(notify.config.notifyEmail)
  } catch { /* 未登录/接口失败 → 按未保存处理 */ }
  visible.value = shouldShowPrompt({ user: auth.user, notifyEmailSaved: saved })
})

function goSettings(): void {
  if (welcome.value) markWelcomeSeen()
  visible.value = false
  router.push('/settings')
}

function dismissSession(): void {
  dismissForSession()
  visible.value = false
}

function dismissForever(): void {
  dismissPermanently()
  visible.value = false
}

function dismissWelcome(): void {
  markWelcomeSeen()
  visible.value = false
}
</script>

<template>
  <!-- 邮箱注册用户: 欢迎条 (告知已开启每日通知) -->
  <div
    v-if="visible && welcome"
    class="flex items-center gap-2 px-4 py-2.5 text-sm bg-emerald-50 dark:bg-emerald-900/30 border-b border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
    data-test="welcome-banner"
  >
    <span class="flex-1">已为你开启每日定投与通道策略邮件通知 (每日 08:30), 可在设置中修改频率或关闭</span>
    <button
      class="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium shrink-0"
      data-test="welcome-go"
      @click="goSettings"
    >去设置</button>
    <button
      class="px-2 py-1 rounded-md text-xs shrink-0 hover:bg-emerald-100 dark:hover:bg-emerald-800/50"
      data-test="welcome-dismiss"
      @click="dismissWelcome"
    >知道了</button>
  </div>

  <!-- guest 等: 填写邮箱提醒横幅 -->
  <div
    v-else-if="visible"
    class="flex items-center gap-2 px-4 py-2.5 text-sm bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200"
    data-test="notify-prompt"
  >
    <span class="flex-1">填写邮箱后可接收每日定投与通道策略通知</span>
    <button
      class="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium shrink-0"
      data-test="prompt-go"
      @click="goSettings"
    >去设置</button>
    <button
      class="px-2 py-1 rounded-md text-xs shrink-0 hover:bg-amber-100 dark:hover:bg-amber-800/50"
      data-test="prompt-session"
      @click="dismissSession"
    >此次不再</button>
    <button
      class="px-2 py-1 rounded-md text-xs shrink-0 hover:bg-amber-100 dark:hover:bg-amber-800/50"
      data-test="prompt-forever"
      @click="dismissForever"
    >永久关闭</button>
  </div>
</template>
