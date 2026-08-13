import { describe, it, expect, beforeEach } from 'vitest'
import { openDB } from 'idb'
import { openDb, DB_NAME, SCHEMA_VERSION, resetDbForTests } from '@/repos/db'
import 'fake-indexeddb/auto'

describe('openDb', () => {
  beforeEach(() => {
    resetDbForTests()
    indexedDB.deleteDatabase(DB_NAME)
  })

  it('exports DB_NAME and SCHEMA_VERSION', () => {
    expect(DB_NAME).toBe('func-db')
    expect(SCHEMA_VERSION).toBe(2)
  })

  it('creates database with all required object stores', async () => {
    const db = await openDb()
    const stores = [...db.objectStoreNames]
    expect(stores).toContain('transactions')
    expect(stores).toContain('categories')
    expect(stores).toContain('budgets')
    expect(stores).toContain('holdings')
    expect(stores).toContain('holdingTxns')
    expect(stores).toContain('permanentTargets')
    expect(stores).toContain('dcaConfigs')
    expect(stores).toContain('indexData')
    expect(stores).toContain('dcaExecutions')
    expect(stores).toContain('dailyDcaConfigs')
    expect(stores).toContain('settings')
    expect(stores).toContain('meta')
    db.close()
  })

  it('opens same DB on second call', async () => {
    const a = await openDb()
    a.close()
    const b = await openDb()
    expect(b.version).toBe(SCHEMA_VERSION)
    b.close()
  })

  it('v1 → v2 升级: 保留历史数据 + 新增 dailyDcaConfigs, 不重建已有 store', async () => {
    // 1. 模拟旧用户 v1 库, 写入若干数据
    indexedDB.deleteDatabase(DB_NAME)
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('holdings', { keyPath: 'id' })
        db.createObjectStore('dcaConfigs', { keyPath: 'id' })
        db.createObjectStore('settings', { keyPath: 'id' })
      }
    })
    await v1.put('holdings', { id: 'h-old', symbol: 'QQQ', name: 'old-holding' })
    await v1.put('dcaConfigs', { id: 'singleton', symbol: 'NDX', monthlyBudget: 80000 })
    v1.close()

    // 2. 新版本 openDb() (v2) 打开 → 触发 1→2 升级
    const v2 = await openDb()
    expect(v2.version).toBe(2)
    const stores = [...v2.objectStoreNames]
    expect(stores).toContain('dailyDcaConfigs') // v2 新增
    expect(stores).toContain('holdings')        // v1 保留

    // 3. 旧数据完整未丢
    const h = await v2.get('holdings', 'h-old')
    expect((h as any)?.symbol).toBe('QQQ')
    const cfg = await v2.get('dcaConfigs', 'singleton')
    expect((cfg as any)?.monthlyBudget).toBe(80000)
    v2.close()
  })
})
