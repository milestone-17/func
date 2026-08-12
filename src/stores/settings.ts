import { defineStore } from 'pinia'
import { ref } from 'vue'
import { settingsRepo } from '@/repos/settingsRepo'
import type { AppSettings } from '@/types/settings'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null)
  const loaded = ref(false)

  async function load() {
    settings.value = await settingsRepo.get()
    loaded.value = true
  }

  async function save(s: Partial<AppSettings>) {
    settings.value = await settingsRepo.save(s)
  }

  return { settings, loaded, load, save }
})
