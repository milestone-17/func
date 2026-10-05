import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export const DB_NAME = 'func-db'
export const SCHEMA_VERSION = 3

export interface FuncDB extends DBSchema {
  transactions: { key: string; value: any; indexes: { 'by-date': string; 'by-type': string } }
  categories: { key: string; value: any }
  budgets: { key: string; value: any; indexes: { 'by-month': string } }
  holdings: { key: string; value: any; indexes: { 'by-symbol': string; 'by-type': string } }
  holdingTxns: { key: string; value: any; indexes: { 'by-holding': string; 'by-date': string } }
  permanentTargets: { key: string; value: any }
  dcaConfigs: { key: string; value: any }
  indexData: { key: string; value: any; indexes: { 'by-symbol': string; 'by-date': string } }
  dcaExecutions: { key: string; value: any; indexes: { 'by-config': string } }
  dailyDcaConfigs: { key: string; value: any }
  settings: { key: string; value: any }
  meta: { key: string; value: any }
  /** v3: 估值分位快照 (主键 = 'YYYY-MM-DD') */
  valuationSnapshots: { key: string; value: any }
}

// 注意: 不使用单例缓存, 每次 openDb() 都打开新连接.
// idb 内部会复用底层的 IndexedDB 连接, 性能无差异.
// 不缓存的原因: 测试场景下 db.close() 后缓存会失效, 重新打开失败.
export function openDb(): Promise<IDBPDatabase<FuncDB>> {
  return openDB<FuncDB>(DB_NAME, SCHEMA_VERSION, {
    upgrade(db, oldVersion) {
      // v1: 初始全部 store
      if (oldVersion < 1) {
        const tx = db.createObjectStore('transactions', { keyPath: 'id' })
        tx.createIndex('by-date', 'date')
        tx.createIndex('by-type', 'type')
        db.createObjectStore('categories', { keyPath: 'id' })
        const b = db.createObjectStore('budgets', { keyPath: 'id' })
        b.createIndex('by-month', 'month')
        const h = db.createObjectStore('holdings', { keyPath: 'id' })
        h.createIndex('by-symbol', 'symbol')
        h.createIndex('by-type', 'type')
        const ht = db.createObjectStore('holdingTxns', { keyPath: 'id' })
        ht.createIndex('by-holding', 'holdingId')
        ht.createIndex('by-date', 'date')
        db.createObjectStore('permanentTargets', { keyPath: 'id' })
        db.createObjectStore('dcaConfigs', { keyPath: 'id' })
        const idx = db.createObjectStore('indexData', { keyPath: ['symbol', 'date'] })
        idx.createIndex('by-symbol', 'symbol')
        idx.createIndex('by-date', 'date')
        const dx = db.createObjectStore('dcaExecutions', { keyPath: 'id' })
        dx.createIndex('by-config', 'configId')
        db.createObjectStore('settings', { keyPath: 'id' })
        db.createObjectStore('meta', { keyPath: 'id' })
      }
      // v2: 每日定投配置
      if (oldVersion < 2) {
        db.createObjectStore('dailyDcaConfigs', { keyPath: 'id' })
      }
      // v3: 估值快照
      if (oldVersion < 3) {
        db.createObjectStore('valuationSnapshots', { keyPath: 'id' })
      }
    }
  })
}

export function resetDbForTests(): void {
  // 云端版: 数据在服务端; 测试中同步清空内存 API 的表 (见 tests/mem-api.ts)
  const g = globalThis as any
  const db = g.__funcMemDb
  if (db) {
    db.tables = new Map()
  }
}

/** 删除整个数据库 (本地遗留数据清理用; 云端版已不再使用 IndexedDB 存储业务数据) */
export function wipeAllData(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}
