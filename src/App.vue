<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { RouterView } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useLockStore } from '@/stores/lock'
import LockScreen from '@/components/LockScreen.vue'

const settings = useSettingsStore()
const lock = useLockStore()

const locked = computed(() => lock.hasPassword && !lock.unlocked)

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  applyTheme()
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
