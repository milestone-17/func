import { api } from '@/lib/api'
import type { DailyDcaConfig } from '@/types/dca'

const ID = 'daily'

export const dailyDcaConfigRepo = {
  /** 单例配置 (id = 'daily') */
  async get(): Promise<DailyDcaConfig | undefined> {
    try {
      const r = await api.get<{ item: DailyDcaConfig }>(`/api/dailyDcaConfigs/${ID}`)
      return r.item
    } catch {
      return undefined
    }
  },
  async save(cfg: Omit<DailyDcaConfig, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<DailyDcaConfig> {
    const existing = await this.get()
    const now = Date.now()
    const out: DailyDcaConfig = existing
      ? { ...existing, ...cfg, updatedAt: now }
      : ({ id: ID, ...cfg, createdAt: now, updatedAt: now, deletedAt: null } as unknown as DailyDcaConfig)
    const r = await api.post<{ item: DailyDcaConfig }>('/api/dailyDcaConfigs', out)
    return r.item
  }
}
