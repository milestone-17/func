import { openDb } from '@/repos/db'
import { newId, makeTimestamps, softDelete, touchUpdated } from '@/repos/base'
import type { Transaction, TxType } from '@/types/ledger'

export interface TxFilter {
  type?: TxType
  from?: string
  to?: string
  categoryId?: string
}

export const transactionRepo = {
  async add(input: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Transaction> {
    const db = await openDb()
    const ts = makeTimestamps()
    const tx: Transaction = { id: newId(), ...input, ...ts }
    await db.add('transactions', tx)
    db.close()
    return tx
  },
  async put(tx: Transaction): Promise<Transaction> {
    const db = await openDb()
    const out = touchUpdated(tx)
    await db.put('transactions', out)
    db.close()
    return out
  },
  async get(id: string): Promise<Transaction | undefined> {
    const db = await openDb()
    const t = await db.get('transactions', id) as Transaction | undefined
    db.close()
    return t
  },
  async softDelete(id: string): Promise<void> {
    const db = await openDb()
    const t = await db.get('transactions', id) as Transaction | undefined
    if (t) {
      await db.put('transactions', softDelete(t))
    }
    db.close()
  },
  async list(filter: TxFilter = {}): Promise<Transaction[]> {
    const db = await openDb()
    let all = await db.getAll('transactions') as Transaction[]
    db.close()
    all = all.filter(t => !t.deletedAt)
    if (filter.type) all = all.filter(t => t.type === filter.type)
    if (filter.categoryId) all = all.filter(t => t.categoryId === filter.categoryId)
    if (filter.from) all = all.filter(t => t.date >= filter.from!)
    if (filter.to) all = all.filter(t => t.date <= filter.to!)
    return all.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  },
  async listByMonth(month: string): Promise<Transaction[]> {
    // month: YYYY-MM
    const from = month + '-01'
    const [y, m] = month.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    const to = `${month}-${String(lastDay).padStart(2, '0')}`
    return this.list({ from, to })
  }
}
