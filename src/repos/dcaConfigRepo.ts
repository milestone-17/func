import { api } from '@/lib/api'
import type { DCAConfig } from '@/types/dca'

function normSymbol(s: string): string {
  return (s || '').replace(/^\^/, '').toUpperCase()
}

async function listAll(): Promise<DCAConfig[]> {
  const r = await api.get<{ items: DCAConfig[] }>('/api/dcaConfigs')
  return (r.items || []).filter(c => !c.deletedAt)
}

export const dcaConfigRepo = {
  /** 单例配置,只存一条 (id = 'singleton') — 旧 API, 保留供过渡 */
  async get(): Promise<DCAConfig | undefined> {
    try {
      const r = await api.get<{ item: DCAConfig }>('/api/dcaConfigs/singleton')
      return r.item
    } catch {
      return undefined
    }
  },
  async save(cfg: Omit<DCAConfig, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<DCAConfig> {
    const existing = await this.get()
    const now = Date.now()
    const out: DCAConfig = existing
      ? { ...existing, ...cfg, updatedAt: now }
      : ({ id: 'singleton', ...cfg, createdAt: now, updatedAt: now, deletedAt: null } as unknown as DCAConfig)
    const r = await api.post<{ item: DCAConfig }>('/api/dcaConfigs', out)
    return r.item
  },
  /** 按 symbol 读取定投配置; NDX 兼容旧 singleton (无破坏性迁移) */
  async getBySymbol(symbol: string): Promise<DCAConfig | undefined> {
    const all = await listAll()
    const norm = normSymbol(symbol)
    let found = all.find(c => normSymbol(c.symbol) === norm)
    if (!found && norm === 'NDX') {
      found = all.find(c => c.id === 'singleton' || !c.symbol)
    }
    return found
  },
  /** 按 symbol 保存定投配置 (id = symbol) */
  async saveBySymbol(symbol: string, cfg: Omit<DCAConfig, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<DCAConfig> {
    const existingResp = await api
      .get<{ item: DCAConfig }>(`/api/dcaConfigs/${encodeURIComponent(symbol)}`)
      .catch(() => undefined)
    const existing = existingResp?.item
    const now = Date.now()
    const out: DCAConfig = existing
      ? { ...existing, ...cfg, symbol, updatedAt: now }
      : ({ id: symbol, ...cfg, symbol, createdAt: now, updatedAt: now, deletedAt: null } as unknown as DCAConfig)
    const r = await api.post<{ item: DCAConfig }>('/api/dcaConfigs', out)
    return r.item
  }
}
