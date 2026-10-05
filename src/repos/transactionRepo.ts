import { makeRemoteRepo } from '@/repos/remote-base'
import type { Transaction, TxType } from '@/types/ledger'

export interface TxFilter {
  type?: TxType
  from?: string
  to?: string
  categoryId?: string
}

const repo = makeRemoteRepo<Transaction>('transactions')

export const transactionRepo = {
  async add(input: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Transaction> {
    return repo.add(input)
  },
  async put(tx: Transaction): Promise<Transaction> {
    return repo.put(tx)
  },
  async get(id: string): Promise<Transaction | undefined> {
    return repo.get(id)
  },
  async softDelete(id: string): Promise<void> {
    return repo.softDelete(id)
  },
  async list(filter: TxFilter = {}): Promise<Transaction[]> {
    const q: Record<string, string> = {}
    if (filter.type) q.type = filter.type
    if (filter.categoryId) q.categoryId = filter.categoryId
    // 日期过滤在客户端做 (与旧实现一致), 服务端仅按列过滤
    const all = await repo.list(q)
    let out = all
    if (filter.from) out = out.filter(t => t.date >= filter.from!)
    if (filter.to) out = out.filter(t => t.date <= filter.to!)
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  },
  async listByMonth(month: string): Promise<Transaction[]> {
    const from = month + '-01'
    const [y, m] = month.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    const to = `${month}-${String(lastDay).padStart(2, '0')}`
    return this.list({ from, to })
  }
}
