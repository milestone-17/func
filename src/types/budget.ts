import type { ID, Timestamp } from './common'

export type AllocationType = 'savings' | 'investment' | 'fixed' | 'discretionary'

export interface BudgetAllocation {
  type: AllocationType
  label: string
  amountFen: number  // 分
  note?: string
}

export interface BudgetPlan {
  id: ID
  month: string  // 'YYYY-MM'
  totalIncome: number  // 分
  allocations: BudgetAllocation[]
  weeklySplits: [number, number, number, number]  // 分
  remainingForDCA: number  // 分
  notes?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt?: Timestamp | null
}
