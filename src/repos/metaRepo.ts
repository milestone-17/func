import { openDb } from '@/repos/db'
import type { MetaEntry } from '@/types/settings'

export const metaRepo = {
  async put(entry: MetaEntry): Promise<MetaEntry> {
    const db = await openDb()
    await db.put('meta', entry)
    db.close()
    return entry
  },
  async get(key: string): Promise<MetaEntry | undefined> {
    const db = await openDb()
    const m = await db.get('meta', key) as MetaEntry | undefined
    db.close()
    return m
  },
  async list(): Promise<MetaEntry[]> {
    const db = await openDb()
    const all = await db.getAll('meta') as MetaEntry[]
    db.close()
    return all
  }
}
