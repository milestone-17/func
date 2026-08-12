import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, DB_NAME, SCHEMA_VERSION, resetDbForTests } from '@/repos/db'
import 'fake-indexeddb/auto'

describe('openDb', () => {
  beforeEach(() => {
    resetDbForTests()
    indexedDB.deleteDatabase(DB_NAME)
  })

  it('exports DB_NAME and SCHEMA_VERSION', () => {
    expect(DB_NAME).toBe('func-db')
    expect(SCHEMA_VERSION).toBe(1)
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
})
