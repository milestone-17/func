<template>
  <div class="min-h-screen bg-canvas">
    <!-- 顶部 -->
    <header class="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
      <div class="mx-auto max-w-md px-4 h-14 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <span class="grid h-6.5 w-6.5 place-items-center rounded-lg bg-brand text-white text-[11px] font-bold shadow-sm">¥</span>
          <h1 class="font-semibold text-[15px] tracking-tight">本地财务</h1>
        </div>
        <div class="flex items-center gap-1">
          <button v-if="installable" @click="install" class="btn-ghost !px-2.5 !py-1 !text-xs">安装</button>
          <RouterLink
            to="/settings"
            class="grid h-9 w-9 place-items-center rounded-xl text-ink2 transition hover:bg-surface2 active:scale-95"
            aria-label="设置"
          >
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="ICONS.settings" />
          </RouterLink>
        </div>
      </div>
    </header>

    <!-- 内容 -->
    <main class="mx-auto max-w-md px-4 pt-4 pb-28">
      <slot />
    </main>

    <!-- 底部导航 -->
    <nav class="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/92 backdrop-blur-md">
      <div class="mx-auto max-w-md grid grid-cols-6">
        <RouterLink v-for="tab in tabs" :key="tab.to" :to="tab.to" :exact="tab.to === '/'" custom v-slot="{ isActive, href, navigate }">
          <a
            :href="href"
            @click="navigate"
            class="flex flex-col items-center gap-1 py-2 transition active:scale-90"
            :class="isActive ? 'text-brand' : 'text-ink3'"
          >
            <svg class="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="tab.icon" />
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
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'
}

const tabs = [
  { to: '/', label: '总览', icon: ICONS.home },
  { to: '/ledger', label: '账本', icon: ICONS.wallet },
  { to: '/budget', label: '预算', icon: ICONS.pie },
  { to: '/portfolio', label: '投资', icon: ICONS.trend },
  { to: '/dca', label: '定投', icon: ICONS.calendar },
  { to: '/permanent', label: '永久', icon: ICONS.shield }
]
</script>
