<template>
  <div class="min-h-screen bg-canvas">
    <!-- 桌面侧边栏 -->
    <aside class="hidden md:flex fixed inset-y-0 left-0 z-40 w-56 flex-col border-r border-line bg-surface">
      <div class="flex items-center gap-2.5 h-14 px-5 border-b border-line">
        <span class="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white text-xs font-bold shadow-sm">¥</span>
        <h1 class="font-semibold text-[15px] tracking-tight">本地财务</h1>
      </div>
      <nav class="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          :exact="tab.to === '/'"
          custom
          v-slot="{ isActive, href, navigate }"
        >
          <a
            :href="href"
            @click="navigate"
            class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors"
            :class="isActive ? 'bg-brand-soft text-brand-700 dark:text-brand font-semibold' : 'text-ink2 hover:bg-surface2 hover:text-ink'"
          >
            <svg class="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="tab.icon" />
            {{ tab.label }}
          </a>
        </RouterLink>
      </nav>
      <div class="border-t border-line px-2.5 py-3 space-y-0.5">
        <button v-if="installable" @click="install" class="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink2 hover:bg-surface2">
          <svg class="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          安装应用
        </button>
        <RouterLink to="/settings" class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink2 hover:bg-surface2 hover:text-ink">
          <svg class="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="ICONS.settings" />
          设置
        </RouterLink>
      </div>
    </aside>

    <!-- 移动端顶栏 -->
    <header class="md:hidden sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
      <div class="mx-auto max-w-md px-4 h-14 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <span class="grid h-6.5 w-6.5 place-items-center rounded-lg bg-brand text-white text-[11px] font-bold shadow-sm">¥</span>
          <h1 class="font-semibold text-[15px] tracking-tight">本地财务</h1>
        </div>
        <RouterLink
          to="/settings"
          class="grid h-9 w-9 place-items-center rounded-xl text-ink2 transition hover:bg-surface2 active:scale-95"
          aria-label="设置"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="ICONS.settings" />
        </RouterLink>
      </div>
    </header>

    <!-- 内容: 桌面偏移侧边栏, 宽容器 -->
    <main class="md:pl-56">
      <div class="mx-auto max-w-5xl px-4 md:px-8 pt-4 pb-28 md:pb-10">
        <slot />
      </div>
    </main>

    <!-- 移动端底部导航 -->
    <nav class="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/92 backdrop-blur-md">
      <div class="mx-auto max-w-md grid grid-cols-8">
        <RouterLink v-for="tab in tabs" :key="tab.to" :to="tab.to" :exact="tab.to === '/'" custom v-slot="{ isActive, href, navigate }">
          <a
            :href="href"
            @click="navigate"
            class="flex flex-col items-center gap-0.5 py-2 transition active:scale-90"
            :class="isActive ? 'text-brand' : 'text-ink3'"
          >
            <svg class="h-[20px] w-[20px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="tab.icon" />
            <span class="text-[10px] leading-none" :class="isActive ? 'font-semibold' : 'font-medium'">{{ tab.label }}</span>
          </a>
        </RouterLink>
      </div>
      <div class="h-[env(safe-area-inset-bottom)]" />
    </nav>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

const installable = ref(false)
let deferred: any = null

onMounted(() => {
  window.addEventListener('beforeinstallprompt', (e: any) => {
    e.preventDefault()
    deferred = e
    installable.value = true
  })
})

function install() {
  if (deferred) {
    deferred.prompt()
    deferred = null
    installable.value = false
  }
}

// 内联 SVG (Lucide 风格描边图标)
const ICONS: Record<string, string> = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  lightbulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2v.3a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V17a3 3 0 0 1 1-2A7 7 0 0 0 12 2Z"/>',
  channel: '<path d="M3 20 9 12l4 4 8-10"/><path d="M21 6v4h-4"/><path d="M3 20h4"/><path d="M21 6l-2.5 2.5"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'
}

const tabs = [
  { to: '/', label: '总览', icon: ICONS.home },
  { to: '/ledger', label: '账本', icon: ICONS.wallet },
  { to: '/budget', label: '预算', icon: ICONS.pie },
  { to: '/portfolio', label: '投资', icon: ICONS.trend },
  { to: '/watch', label: '自选', icon: ICONS.star },
  { to: '/dca', label: '定投', icon: ICONS.calendar },
  { to: '/suggest', label: '建议', icon: ICONS.lightbulb },
  { to: '/channel', label: '通道', icon: ICONS.channel },
  { to: '/permanent', label: '永久', icon: ICONS.shield }
]
</script>
