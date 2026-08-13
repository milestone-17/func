/**
 * 备份/恢复 (JSON 单文件)
 * - 包含所有 object store 数据
 * - 文件名: func-backup-YYYYMMDD-HHmm.json
 * - 下载使用 Blob + a[download]
 */
import type { MetaEntry } from '@/types/settings'
import { settingsRepo } from '@/repos/settingsRepo'
import { openDb } from '@/repos/db'

// 备份文件格式版本 (与 DB schema 版本独立; 结构未变则保持 1, 兼容旧备份)
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

/**
 * 导出: 用单个 readonly 事务一次性取所有 store
 */
export async function exportAll(): Promise<BackupBundle> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAMES, 'readonly')
    const data: Record<string, unknown[]> = {}
    for (const name of STORE_NAMES) {
      data[name] = await tx.objectStore(name).getAll()
    }
    await tx.done
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data
    }
  } finally {
    db.close()
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
    // 成功导出后记录最近备份时间 (消除备份提醒)
    settingsRepo.save({ lastBackupAt: Date.now() }).catch(() => { /* 忽略 */ })
  })
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
}

export async function importAll(bundle: BackupBundle, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  if (!bundle || bundle.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`不兼容的备份版本: ${bundle?.schemaVersion}`)
  }
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAMES, 'readwrite')
    for (const name of STORE_NAMES) {
      const store = tx.objectStore(name)
      if (mode === 'replace') await store.clear()
      const rows = bundle.data[name] || []
      for (const r of rows) {
        await store.put(r)
      }
    }
    await tx.done
  } finally {
    db.close()
  }
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

/** 读取所有 meta 条目 */
export async function getMetaAll(): Promise<MetaEntry[]> {
  const db = await openDb()
  try {
    const list = await db.getAll('meta') as MetaEntry[]
    return list
  } finally {
    db.close()
  }
}
