import { openDb } from '@/repos/db'
import { touchUpdated } from '@/repos/base'
import type { DCAConfig } from '@/types/dca'

function normSymbol(s: string): string {
  return (s || '').replace(/^\^/, '').toUpperCase()
}

export const dcaConfigRepo = {
  /** 单例配置,只存一条 (id = 'singleton') — 旧 API, 保留供过渡 */
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
  },
  /** 按 symbol 读取定投配置; NDX 兼容旧 singleton (无破坏性迁移) */
  async getBySymbol(symbol: string): Promise<DCAConfig | undefined> {
    const db = await openDb()
    const all = await db.getAll('dcaConfigs') as DCAConfig[]
    db.close()
    const norm = normSymbol(symbol)
    // 优先按 symbol 字段精确匹配
    let found = all.find(c => !c.deletedAt && normSymbol(c.symbol) === norm)
    // NDX 兼容旧 singleton: id='singleton' 或缺 symbol 字段的视为 NDX
    if (!found && norm === 'NDX') {
      found = all.find(c => !c.deletedAt && (c.id === 'singleton' || !c.symbol))
    }
    return found
  },
  /** 按 symbol 保存定投配置 (id = symbol) */
  async saveBySymbol(symbol: string, cfg: Omit<DCAConfig, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<DCAConfig> {
    const db = await openDb()
    const id = symbol
    const existing = await db.get('dcaConfigs', id) as DCAConfig | undefined
    const now = Date.now()
    const out: DCAConfig = existing
      ? touchUpdated({ ...existing, ...cfg, symbol })
      : { id, ...cfg, symbol, createdAt: now, updatedAt: now, deletedAt: null }
    await db.put('dcaConfigs', out)
    db.close()
    return out
  }
}
