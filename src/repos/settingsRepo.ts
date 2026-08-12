import { openDb } from '@/repos/db'
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
  updatedAt: Date.now()
}

export const settingsRepo = {
  async get(): Promise<AppSettings> {
    const db = await openDb()
    const s = await db.get('settings', SINGLETON_ID) as AppSettings | undefined
    db.close()
    return s || { ...DEFAULTS, updatedAt: Date.now() }
  },
  async save(s: Partial<AppSettings>): Promise<AppSettings> {
    const db = await openDb()
    const cur = (await db.get('settings', SINGLETON_ID) as AppSettings | undefined) || { ...DEFAULTS }
    const out: AppSettings = { ...cur, ...s, id: SINGLETON_ID, updatedAt: Date.now() }
    await db.put('settings', out)
    db.close()
    return out
  }
}
