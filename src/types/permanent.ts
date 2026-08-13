import type { ID, Timestamp } from './common'

export type AssetType = 'stock' | 'bond' | 'cash' | 'gold'

export interface HoldingForPerm {
  category?: string   // 持仓分类标签 (nasdaq100/sp500/dividend/bond/other)
  type: string        // 持仓原始类型 (stock/etf/bond/cash/gold/...)
  marketValueCNY: number  // 分
}

export interface PermTarget {
  id: ID
  assetType: AssetType
  targetPercent: number
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt?: Timestamp | null
}
