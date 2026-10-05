import { api } from '@/lib/api'
import type { MetaEntry } from '@/types/settings'

export const metaRepo = {
  async put(entry: MetaEntry): Promise<MetaEntry> {
    // 服务端 meta_entries 表主键 id; 前端 MetaEntry 主键是 key — 用 key 作 id 存取
    const payload = { id: entry.key, ...entry } as MetaEntry & { id: string }
    const r = await api.post<{ item: MetaEntry }>('/api/meta', payload)
    return r.item
  },
  async get(key: string): Promise<MetaEntry | undefined> {
    try {
      const r = await api.get<{ item: MetaEntry }>(`/api/meta/${encodeURIComponent(key)}`)
      return r.item
    } catch {
      return undefined
    }
  },
  async list(): Promise<MetaEntry[]> {
    const r = await api.get<{ items: MetaEntry[] }>('/api/meta')
    return r.items
  }
}
