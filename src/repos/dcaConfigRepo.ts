import { openDb } from '@/repos/db'
import { touchUpdated } from '@/repos/base'
import type { DCAConfig } from '@/types/dca'

export const dcaConfigRepo = {
  /** 单例配置,只存一条 (id = 'singleton') */
  async get(): Promise<DCAConfig | undefined> {
    const db = await openDb()
    const c = await db.get('dcaConfigs', 'singleton') as DCAConfig | undefined
    db.close()
    return c
  },
  async save(cfg: Omit<DCAConfig, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<DCAConfig> {
    const db = await openDb()
    const existing = await db.get('dcaConfigs', 'singleton') as DCAConfig | undefined
    const now = Date.now()
    const out: DCAConfig = existing
      ? touchUpdated({ ...existing, ...cfg })
      : { id: 'singleton', ...cfg, createdAt: now, updatedAt: now, deletedAt: null }
    await db.put('dcaConfigs', out)
    db.close()
    return out
  }
}
