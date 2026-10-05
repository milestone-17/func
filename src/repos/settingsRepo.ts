import { api } from '@/lib/api'
import type { AppSettings } from '@/types/settings'

const SINGLETON_ID = 'app'

const DEFAULTS: AppSettings = {
  id: SINGLETON_ID,
  theme: 'system',
  baseCurrency: 'CNY',
  usdCnyRate: 7.2,
  rateUpdatedAt: Date.now(),
  permanentThreshold: 5,
  lastIndexSync: {},
  schemaVersion: 1,
  passHash: null,
  passSalt: null,
  lastBackupAt: null,
  backupReminderDays: 30,
  backupReminderSnoozedAt: null,
  storagePersisted: null,
  updatedAt: Date.now()
}

export const settingsRepo = {
  async get(): Promise<AppSettings> {
    try {
      const r = await api.get<{ item: AppSettings }>('/api/settings/app')
      return r.item
    } catch {
      return { ...DEFAULTS, updatedAt: Date.now() }
    }
  },
  async save(s: Partial<AppSettings>): Promise<AppSettings> {
    const cur = await this.get()
    const out: AppSettings = { ...cur, ...s, id: SINGLETON_ID, updatedAt: Date.now() }
    const r = await api.post<{ item: AppSettings }>('/api/settings', out)
    return r.item
  }
}
