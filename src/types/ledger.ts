import type { ID, ISODate, Timestamp } from './common'

export type TxType = 'income' | 'expense'

export interface Transaction {
  id: ID
  date: ISODate
  type: TxType
  amount: number  // 分
  categoryId: ID
  note?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt?: Timestamp | null
}

export interface Category {
  id: ID
  name: string
  type: 'income' | 'expense' | 'both'
  color: string
  icon?: string
  order: number
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt?: Timestamp | null
}
