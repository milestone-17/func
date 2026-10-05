<script setup lang="ts">
/**
 * 邮箱填写提醒横幅: 无真实邮箱用户 (guest/@guest.local) 进入应用时显示。
 * 三动作: 去设置 / 此次不再提醒 / 永久关闭。
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useNotifyStore } from '@/stores/notify'
import {
  shouldShowPrompt, dismissForSession, dismissPermanently
} from '@/lib/notifyPrompt'

const router = useRouter()
const auth = useAuthStore()
const notify = useNotifyStore()

const visible = ref(false)

onMounted(async () => {
  // 已登录才可能需要; 尝试取通知配置判断"已保存通知邮箱"
  if (!auth.isLoggedIn) return
  let saved = false
  try {
    await notify.load()
    saved = !!notify.config?.notifyEmail && !/@guest\.local$/i.test(notify.config.notifyEmail)
  } catch { /* 未登录/接口失败 → 按未保存处理 */ }
  visible.value = shouldShowPrompt({ user: auth.user, notifyEmailSaved: saved })
})

function goSettings(): void {
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
</script>

<template>
  <div
    v-if="visible"
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
