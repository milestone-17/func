import { openDb } from '@/repos/db'
import { touchUpdated } from '@/repos/base'
import type { DailyDcaConfig } from '@/types/dca'

const ID = 'daily'

export const dailyDcaConfigRepo = {
  /** 单例配置 (id = 'daily') */
  async get(): Promise<DailyDcaConfig | undefined> {
    const db = await openDb()
    const c = await db.get('dailyDcaConfigs', ID) as DailyDcaConfig | undefined
    db.close()
    return c
  },
  async save(cfg: Omit<DailyDcaConfig, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<DailyDcaConfig> {
    const db = await openDb()
    const existing = await db.get('dailyDcaConfigs', ID) as DailyDcaConfig | undefined
    const now = Date.now()
    const out: DailyDcaConfig = existing
      ? touchUpdated({ ...existing, ...cfg })
      : { id: ID, ...cfg, createdAt: now, updatedAt: now, deletedAt: null }
    await db.put('dailyDcaConfigs', out)
    db.close()
    return out
  }
}
