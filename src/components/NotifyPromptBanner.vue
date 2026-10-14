<script setup lang="ts">
/**
 * 通知引导弹窗 (三类, 居中模态呈现):
 *   - 邮箱注册用户未开启通知 → 功能介绍弹窗 (引导去设置绑定, 支持此次/永久关闭)
 *   - 邮箱注册用户已开启通知 → "已为你开启" 欢迎弹窗 (仅一次)
 *   - guest 等无真实邮箱用户 → 邮箱填写引导 (三动作)
 *
 * 呈现: 遮罩 + 屏幕居中卡片, 淡入 + 轻缩放动画; 遮罩点击 / Esc = 此次不再 (欢迎弹窗 = 知道了)。
 * 时序说明: App 挂载早于 auth.init() (/api/me 探活) 完成, onMounted 时 user 必为 null。
 * 因此用 watch(user) 驱动评估: 登录态就绪或变化 (登录/登出/换账号) 都会重新评估一次,
 * 幂等且无竞态。
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useNotifyStore } from '@/stores/notify'
import {
  shouldShowPrompt, shouldShowWelcome, shouldShowEmailIntro,
  dismissForSession, dismissPermanently, markWelcomeSeen
} from '@/lib/notifyPrompt'

const router = useRouter()
const auth = useAuthStore()
const notify = useNotifyStore()

const visible = ref(false)
const welcome = ref(false) // true=邮箱用户欢迎弹窗 (已开启), false=填写引导
const intro = ref(false) // true=邮箱注册但未开启通知 → 功能介绍弹窗

let seq = 0 // 评估序号: 防止过期异步评估覆盖新状态 (换账号竞态)

async function evaluate(): Promise<void> {
  const my = ++seq
  visible.value = false
  if (!auth.user) return
  // 通知配置两种"已配置"语义:
  //   notifySaved = 填过通知邮箱 (guest 填写提醒的关闭条件)
  //   notifyOn    = 通知已启用 (邮箱注册用户"已绑定"判定; 注册时自动写入注册邮箱但 enabled=false,
  //                 若只看邮箱非空, 介绍弹窗永远不会出现)
  let notifySaved = false
  let notifyOn = false
  try {
    await notify.load()
    if (my !== seq) return // 评估期间账号已切换, 丢弃
    const cfg = notify.config
    notifySaved = !!cfg?.notifyEmail && !/@guest\.local$/i.test(cfg.notifyEmail)
    notifyOn = !!cfg?.enabled && notifySaved
  } catch { /* 接口失败 → 按未配置处理 */ }
  // 邮箱注册用户分流: 未开启通知 → 功能介绍弹窗; 已开启 → 欢迎"已开启"
  if (shouldShowEmailIntro({ user: auth.user, notifyEmailSaved: notifyOn })) {
    intro.value = true
    welcome.value = false
    visible.value = true
    return
  }
  if (shouldShowWelcome({ user: auth.user, notifyOn: notifyOn })) {
    welcome.value = true
    intro.value = false
    visible.value = true
    return
  }
  // guest 等: 原"填写邮箱提醒"逻辑
  intro.value = false
  welcome.value = false
  visible.value = shouldShowPrompt({ user: auth.user, notifyEmailSaved: notifySaved })
}

// 登录态就绪/变化时评估 (immediate 覆盖 user 已就绪的重挂载场景)
watch(() => auth.user, evaluate, { immediate: true })

// 弹窗打开时锁定背景滚动
watch(visible, (v) => {
  if (typeof document !== 'undefined') document.body.style.overflow = v ? 'hidden' : ''
})

function goSettings(): void {
  if (welcome.value) markWelcomeSeen()
  if (intro.value) dismissForSession() // 去绑定 → 本会话不再唠叨
  visible.value = false
  router.push('/settings')
}

function dismissIntroSession(): void {
  dismissForSession()
  visible.value = false
}

function dismissIntroForever(): void {
  // 永久关闭同时标记 welcome seen: 绑定后也不弹"已开启"欢迎条
  dismissPermanently()
  markWelcomeSeen()
  visible.value = false
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

/** 遮罩点击 / Esc: 温和关闭 = 此次不再 (欢迎弹窗按"知道了"处理, 避免下次再弹打扰) */
function onBackdrop(): void {
  if (welcome.value) dismissWelcome()
  else dismissSession()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && visible.value) onBackdrop()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})

// ---- 呈现层: 三类弹窗的配色与文案 ----
const isIntro = computed(() => intro.value)
const isWelcome = computed(() => welcome.value)

const tone = computed(() => {
  if (isWelcome.value) {
    return {
      iconWrap: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
      primary: 'bg-emerald-600 hover:bg-emerald-500 focus-visible:outline-emerald-600',
      title: '邮件通知已开启',
      desc: '已为你开启智能定投与通道策略邮件通知 (每日 08:30), 可在设置中修改频率或关闭'
    }
  }
  if (isIntro.value) {
    return {
      iconWrap: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
      primary: 'bg-sky-600 hover:bg-sky-500 focus-visible:outline-sky-600',
      title: '开启邮件通知',
      desc: '支持邮件通知: 智能定投执行与通道策略提醒 (每日 08:30)。绑定邮箱后即可接收'
    }
  }
  return {
    iconWrap: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
    primary: 'bg-amber-600 hover:bg-amber-500 focus-visible:outline-amber-600',
    title: '接收邮件通知',
    desc: '填写邮箱后可接收智能定投与通道策略通知'
  }
})

const dialogTest = computed(() =>
  isIntro.value ? 'email-intro' : isWelcome.value ? 'welcome-banner' : 'notify-prompt'
)
</script>

<template>
  <Teleport to="body">
    <Transition name="np-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
        data-test="np-overlay"
        @click.self="onBackdrop"
      >
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="tone.title"
          class="np-card w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 px-6 pt-7 pb-6 text-center"
          :data-test="dialogTest"
        >
          <!-- 图标 -->
          <div
            class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            :class="tone.iconWrap"
          >
            <!-- 信封图标 -->
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                 class="h-7 w-7" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <path d="m3.5 7.5 8.5 5.5 8.5-5.5" />
            </svg>
          </div>

          <!-- 文案 -->
          <h2 class="text-base font-semibold text-slate-900 dark:text-slate-100">{{ tone.title }}</h2>
          <p class="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{{ tone.desc }}</p>

          <!-- 主操作 -->
          <button
            class="mt-5 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            :class="tone.primary"
            :data-test="isIntro ? 'intro-go' : 'prompt-go'"
            @click="goSettings"
          >{{ isIntro ? '去绑定' : '去设置' }}</button>

          <!-- 次操作 -->
          <div class="mt-2.5 flex items-center gap-2">
            <button
              v-if="!isWelcome"
              class="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              :data-test="isIntro ? 'intro-session' : 'prompt-session'"
              @click="isIntro ? dismissIntroSession() : dismissSession()"
            >此次不再</button>
            <button
              class="flex-1 rounded-xl px-3 py-2 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              :data-test="isIntro ? 'intro-forever' : isWelcome ? 'welcome-dismiss' : 'prompt-forever'"
              @click="isIntro ? dismissIntroForever() : isWelcome ? dismissWelcome() : dismissForever()"
            >{{ isWelcome ? '知道了' : '永久关闭' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.np-fade-enter-active,
.np-fade-leave-active {
  transition: opacity 0.2s ease;
}
.np-fade-enter-from,
.np-fade-leave-to {
  opacity: 0;
}
.np-card {
  animation: np-pop 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes np-pop {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .np-fade-enter-active,
  .np-fade-leave-active {
    transition: none;
  }
  .np-card {
    animation: none;
  }
}
</style>
