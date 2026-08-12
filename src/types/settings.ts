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
  lastBackupAt?: number | null          // 最近一次成功导出备份的时间戳
  backupReminderDays?: number           // 备份提醒阈值 (天), 默认 30
  backupReminderSnoozedAt?: number | null // "稍后提醒" 时间戳
  storagePersisted?: boolean | null     // 持久化存储授权结果
  updatedAt?: number
}

export interface MetaEntry {
  key: string
  value: any
}
