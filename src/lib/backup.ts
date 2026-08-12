/**
 * 备份/恢复 (JSON 单文件)
 * - 包含所有 object store 数据
 * - 文件名: func-backup-YYYYMMDD-HHmm.json
 * - 下载使用 Blob + a[download]
 */
import { openDB } from 'idb'
import type { MetaEntry } from '@/types/settings'

const DB_NAME = 'func-db'
const SCHEMA_VERSION = 1

const STORE_NAMES = [
  'transactions', 'categories', 'budgets', 'holdings', 'holdingTxns',
  'permanentTargets', 'dcaConfigs', 'indexData', 'dcaExecutions', 'settings', 'meta'
] as const

/**
 * 自行 openDB, 不走 repos/db 的 schema 配置
 * (避免与生产代码 schema 升级产生冲突)
 */
async function openBackupDb() {
  return openDB(DB_NAME, SCHEMA_VERSION, {
    upgrade(db) {
      // 重建所有 store. 真实生产代码 src/repos/db.ts 才是权威 schema.
      // 这里只兜底: 如果 store 已存在, 不会重复 create.
      if (!db.objectStoreNames.contains('transactions')) {
        const tx = db.createObjectStore('transactions', { keyPath: 'id' })
        tx.createIndex('by-date', 'date')
        tx.createIndex('by-type', 'type')
      }
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('budgets')) {
        const b = db.createObjectStore('budgets', { keyPath: 'id' })
        b.createIndex('by-month', 'month')
      }
      if (!db.objectStoreNames.contains('holdings')) {
        const h = db.createObjectStore('holdings', { keyPath: 'id' })
        h.createIndex('by-symbol', 'symbol')
        h.createIndex('by-type', 'type')
      }
      if (!db.objectStoreNames.contains('holdingTxns')) {
        const ht = db.createObjectStore('holdingTxns', { keyPath: 'id' })
        ht.createIndex('by-holding', 'holdingId')
        ht.createIndex('by-date', 'date')
      }
      if (!db.objectStoreNames.contains('permanentTargets')) db.createObjectStore('permanentTargets', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('dcaConfigs')) db.createObjectStore('dcaConfigs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('indexData')) {
        const idx = db.createObjectStore('indexData', { keyPath: ['symbol', 'date'] })
        idx.createIndex('by-symbol', 'symbol')
        idx.createIndex('by-date', 'date')
      }
      if (!db.objectStoreNames.contains('dcaExecutions')) {
        const dx = db.createObjectStore('dcaExecutions', { keyPath: 'id' })
        dx.createIndex('by-config', 'configId')
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
    }
  })
}

export interface BackupBundle {
  schemaVersion: number
  exportedAt: string
  data: Record<string, unknown[]>
}

/**
 * 导出: 用单个 readonly 事务一次性取所有 store
 */
export async function exportAll(): Promise<BackupBundle> {
  const db = await openBackupDb()
  try {
    const tx = db.transaction(STORE_NAMES as unknown as string[], 'readonly')
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
  })
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
}

export async function importAll(bundle: BackupBundle, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  if (!bundle || bundle.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`不兼容的备份版本: ${bundle?.schemaVersion}`)
  }
  const db = await openBackupDb()
  try {
    const tx = db.transaction(STORE_NAMES as unknown as string[], 'readwrite')
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
  const db = await openBackupDb()
  try {
    const list = await db.getAll('meta') as MetaEntry[]
    return list
  } finally {
    db.close()
  }
}
