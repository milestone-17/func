import type { ID, ISODate, Timestamp } from './common'

export type HoldingType = 'stock' | 'etf' | 'crypto' | 'bond' | 'cash' | 'gold'
export type HoldingCategory = 'nasdaq100' | 'sp500' | 'bond' | 'dividend' | 'other'
export type Market = 'CN' | 'US' | 'HK'
export type Currency = 'CNY' | 'USD'

export interface Holding {
  id: ID
  symbol: string
  name: string
  type: HoldingType
  category?: HoldingCategory  // 资产分类标签, 默认 'other'
  market: Market
  currency: Currency
  quantity: number
  avgCost: number  // 分
  currentPrice?: number | null  // 分
  currentPriceAt?: number | null
  currentPriceIsEstimate?: boolean | null  // 现价是否为估算值 (基金盘中估值)
  notes?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt?: Timestamp | null
}

export type HoldingTxnType = 'buy' | 'sell' | 'dividend' | 'fee'

export interface HoldingTxn {
  id: ID
  holdingId: ID
  side: HoldingTxnType
  date: ISODate
  quantity?: number
  price?: number  // 分
  amount?: number  // 分
  fee?: number  // 分
  note?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt?: Timestamp | null
}
