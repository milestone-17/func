import { openDb } from '@/repos/db'
import { newId, makeTimestamps, softDelete, touchUpdated } from '@/repos/base'
import type { Holding, Market, Currency, HoldingType } from '@/types/portfolio'

export interface HoldingFilter {
  market?: Market
  type?: HoldingType
  currency?: Currency
}

export const holdingRepo = {
  async add(input: Omit<Holding, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Holding> {
    const db = await openDb()
    const ts = makeTimestamps()
    const h: Holding = { id: newId(), ...input, ...ts }
    await db.add('holdings', h)
    db.close()
    return h
  },
  async put(h: Holding): Promise<Holding> {
    const db = await openDb()
    const out = touchUpdated(h)
    await db.put('holdings', out)
    db.close()
    return out
  },
  async get(id: string): Promise<Holding | undefined> {
    const db = await openDb()
    const h = await db.get('holdings', id) as Holding | undefined
    db.close()
    return h
  },
  async softDelete(id: string): Promise<void> {
    const db = await openDb()
    const h = await db.get('holdings', id) as Holding | undefined
    if (h) await db.put('holdings', softDelete(h))
    db.close()
  },
  async list(filter: HoldingFilter = {}): Promise<Holding[]> {
    const db = await openDb()
    const all = await db.getAll('holdings') as Holding[]
    db.close()
    let out = all.filter(h => !h.deletedAt)
    if (filter.market) out = out.filter(h => h.market === filter.market)
    if (filter.type) out = out.filter(h => h.type === filter.type)
    if (filter.currency) out = out.filter(h => h.currency === filter.currency)
    return out
  }
}
