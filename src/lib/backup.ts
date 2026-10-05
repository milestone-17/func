/**
 * 备份/恢复 (JSON 单文件) — 云端版
 * - 导出: 从服务端 API 读取当前用户全部数据
 * - 导入: 上传到服务端 /api/import (服务端事务幂等合并)
 * - 兼容旧 IndexedDB 备份文件格式 (schemaVersion=1 + data.{store}[])
 */
import { api } from '@/lib/api'
import { settingsRepo } from '@/repos/settingsRepo'
import type { MetaEntry } from '@/types/settings'

const SCHEMA_VERSION = 1

const STORE_NAMES = [
  'transactions', 'categories', 'budgets', 'holdings', 'holdingTxns',
  'permanentTargets', 'dcaConfigs', 'indexData', 'dcaExecutions',
  'dailyDcaConfigs', 'settings', 'meta'
] as const

export interface BackupBundle {
  schemaVersion: number
  exportedAt: string
  data: Record<string, unknown[]>
}

const API_RESOURCE: Record<string, string> = {
  transactions: 'transactions',
  categories: 'categories',
  budgets: 'budgets',
  holdings: 'holdings',
  holdingTxns: 'holdingTxns',
  permanentTargets: 'permanentTargets',
  dcaConfigs: 'dcaConfigs',
  indexData: 'indexData',
  dcaExecutions: 'dcaExecutions',
  dailyDcaConfigs: 'dailyDcaConfigs',
  settings: 'settings',
  meta: 'meta'
}

/** 导出: 逐资源拉取当前用户数据 */
export async function exportAll(): Promise<BackupBundle> {
  const data: Record<string, unknown[]> = {}
  for (const store of STORE_NAMES) {
    const resource = API_RESOURCE[store]
    try {
      const r = await api.get<{ items: unknown[] }>(`/api/${resource}`)
      data[store] = r.items
    } catch {
      data[store] = []
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data
  }
}

export function downloadBackup(): void {
  exportAll().then(bundle => {
    const json = JSON.stringify(bundle, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const now = new Date()
    const fname = `func-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`
    const a = document.createElement('a')
    a.href = url
    a.download = fname
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    settingsRepo.save({ lastBackupAt: Date.now() }).catch(() => { /* 忽略 */ })
  })
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
}

/** 导入: 上传 bundle 到服务端, 事务内 upsert 幂等合并 (mode 保留兼容旧签名) */
export async function importAll(bundle: BackupBundle, _mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  if (!bundle || bundle.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`不兼容的备份版本: ${bundle?.schemaVersion}`)
  }
  await api.post('/api/import', bundle)
}

/**
 * 校验: 必须含 schemaVersion, exportedAt, data
 */
export function isValidBundle(b: unknown): b is BackupBundle {
  if (!b || typeof b !== 'object') return false
  const o = b as Record<string, unknown>
  if (typeof o.schemaVersion !== 'number') return false
  if (typeof o.exportedAt !== 'string') return false
  if (!o.data || typeof o.data !== 'object') return false
  return true
}

/** 读取所有 meta 条目 (远程) */
export async function getMetaAll(): Promise<MetaEntry[]> {
  const r = await api.get<{ items: MetaEntry[] }>('/api/meta')
  return r.items
}
