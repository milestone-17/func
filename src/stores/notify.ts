/**
 * 通知设置 store: 读写 /api/notifications/config
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/lib/api'

export interface NotifyConfig {
  enabled: boolean
  notifyEmail: string
  frequency: 'daily' | 'weekly'
  dayOfWeek: number
  time: string
}

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export const useNotifyStore = defineStore('notify', () => {
  const config = ref<NotifyConfig | null>(null)
  const loading = ref(false)
  const saving = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const r = await api.get<{ config: NotifyConfig }>('/api/notifications/config')
      config.value = r.config
    } finally {
      loading.value = false
    }
  }

  async function save(patch: Partial<NotifyConfig>): Promise<NotifyConfig> {
    saving.value = true
    try {
      const r = await api.put<{ config: NotifyConfig }>('/api/notifications/config', patch)
      config.value = r.config
      return r.config
    } finally {
      saving.value = false
    }
  }

  /** 发送测试邮件到当前通知邮箱 */
  async function sendTest(): Promise<void> {
    await api.post('/api/notifications/test')
  }

  return { config, loading, saving, load, save, sendTest }
})
