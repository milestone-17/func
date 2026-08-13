<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { RouterView } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useLockStore } from '@/stores/lock'
import { useDailyDcaStore } from '@/stores/dailyDca'
import { requestPersist } from '@/lib/persist'
import LockScreen from '@/components/LockScreen.vue'

const settings = useSettingsStore()
const lock = useLockStore()
const dailyDca = useDailyDcaStore()

const locked = computed(() => lock.hasPassword && !lock.unlocked)

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  applyTheme()
  // 异步申请持久化存储 (不阻塞、不抛错)
  requestPersist()
    .then(r => settings.save({ storagePersisted: r === 'granted' }))
    .catch(() => { /* 忽略 */ })
  // 每日定投: 打开应用时幂等校验并自动记账 (仅当日, 浏览器关闭不执行)
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
  <LockScreen v-if="locked" />
  <RouterView v-else />
</template>
