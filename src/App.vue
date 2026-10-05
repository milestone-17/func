<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useDailyDcaStore } from '@/stores/dailyDca'
import NotifyPromptBanner from '@/components/NotifyPromptBanner.vue'

const settings = useSettingsStore()
const auth = useAuthStore()
const dailyDca = useDailyDcaStore()

onMounted(async () => {
  if (!auth.initialized) await auth.init()
  if (!auth.isLoggedIn) return
  if (!settings.loaded) await settings.load()
  applyTheme()
  // 每日定投: 打开应用时幂等校验并自动记账 (仅当日)
  try {
    await dailyDca.load()
    await dailyDca.runIfPending()
  } catch { /* 不阻塞启动 */ }
})

function applyTheme() {
  const t = settings.settings?.theme
  if (t === 'dark') document.documentElement.classList.add('dark')
  else if (t === 'light') document.documentElement.classList.remove('dark')
  else document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)
}
</script>

<template>
  <NotifyPromptBanner />
  <RouterView />
</template>
