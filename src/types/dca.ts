import type { ID, ISODate, Timestamp } from './common'

export interface BucketResult {
  rate: number  // 0.0~2.8
  label: string
  side: 'high' | 'low' | 'flat'
}

export interface DCAConfig {
  id: ID
  name: string
  symbol: string
  monthlyBudget: number  // 分
  weeklySplits: [number, number, number, number]  // 分
  deviationAlertPercent: number
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt?: Timestamp | null
}

/** 单日指数行 (主键 ['symbol','date']) */
export interface IndexData {
  symbol: string
  date: ISODate
  close: number
  ma250: number | null
  source: 'stooq' | 'manual' | 'cache'
  fetchedAt: Timestamp
}

export interface DCAExecution {
  id: ID
  configId: ID
  month: string  // 'YYYY-MM'
  weekIndex: 1 | 2 | 3 | 4
  date: ISODate
  symbol: string
  plannedAmount: number  // 分
  suggestedAmount: number  // 分
  executedAmount: number  // 分
  deviationPct: number
  priceAtBuy: number  // 元
  sharesBought: number
  note?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt?: Timestamp | null
}
