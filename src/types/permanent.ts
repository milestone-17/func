import type { ID, Timestamp } from './common'

export type AssetType = 'stock' | 'bond' | 'cash' | 'gold'

export interface HoldingForPerm {
  type: AssetType
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
