import type { Currency } from './portfolio'

export type Theme = 'light' | 'dark' | 'system'

export interface AppSettings {
  id: 'app'
  theme: Theme
  baseCurrency: Currency
  usdCnyRate: number
  rateUpdatedAt: number
  permanentThreshold: number
  lastIndexSync: { qqq?: number }
  schemaVersion: number
  passHash?: string | null   // 应用锁密码哈希 (SHA-256 + 盐)
  passSalt?: string | null   // 应用锁盐
  updatedAt?: number
}

export interface MetaEntry {
  key: string
  value: any
}
