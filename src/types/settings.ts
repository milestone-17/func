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
  updatedAt?: number
}

export interface MetaEntry {
  key: string
  value: any
}
