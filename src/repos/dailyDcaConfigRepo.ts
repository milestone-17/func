import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import type { DailyDcaConfig } from '@/types/dca'

/** 每日定投为每用户单例: id 按用户隔离, 避免全局 'daily' 被他人占用导致 409 */
function dailyId(): string {
  const auth = useAuthStore()
  return `daily_${auth.user?.id ?? 'anon'}`
}

export const dailyDcaConfigRepo = {
  /** 单例配置 (每用户 id = 'daily_<userId>') */
  async get(): Promise<DailyDcaConfig | undefined> {
    try {
      const r = await api.get<{ item: DailyDcaConfig }>(`/api/dailyDcaConfigs/${dailyId()}`)
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
      : ({ id: dailyId(), ...cfg, createdAt: now, updatedAt: now, deletedAt: null } as unknown as DailyDcaConfig)
    const r = await api.post<{ item: DailyDcaConfig }>('/api/dailyDcaConfigs', out)
    return r.item
  }
}
