import { makeRemoteRepo } from '@/repos/remote-base'
import type { Holding, Market, Currency, HoldingType } from '@/types/portfolio'

export interface HoldingFilter {
  market?: Market
  type?: HoldingType
  currency?: Currency
}

const repo = makeRemoteRepo<Holding>('holdings')

export const holdingRepo = {
  async add(input: Omit<Holding, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Holding> {
    return repo.add(input)
  },
  async put(h: Holding): Promise<Holding> {
    return repo.put(h)
  },
  async get(id: string): Promise<Holding | undefined> {
    return repo.get(id)
  },
  async softDelete(id: string): Promise<void> {
    return repo.softDelete(id)
  },
  async list(filter: HoldingFilter = {}): Promise<Holding[]> {
    let out = await repo.list()
    if (filter.market) out = out.filter(h => h.market === filter.market)
    if (filter.type) out = out.filter(h => h.type === filter.type)
    if (filter.currency) out = out.filter(h => h.currency === filter.currency)
    return out
  }
}
