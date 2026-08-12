import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { exportAll, importAll, isValidBundle } from '@/lib/backup'
import { openDb, resetDbForTests } from '@/repos/db'

describe('backup', () => {
  beforeEach(async () => {
    resetDbForTests()
    // deleteDatabase 是异步的, 必须 await 否则下个 test 看到的是旧数据
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('func-db')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })

  it('isValidBundle validates shape', () => {
    expect(isValidBundle({ schemaVersion: 1, exportedAt: 'x', data: {} })).toBe(true)
    expect(isValidBundle(null)).toBe(false)
    expect(isValidBundle({})).toBe(false)
    expect(isValidBundle({ schemaVersion: '1', exportedAt: 'x', data: {} })).toBe(false)
  })

  it('exportAll returns all stores', async () => {
    const db = await openDb()
    // settings store keyPath = 'id', 必须带 id
    await db.put('settings', { id: 'app', theme: 'light', usdCnyRate: 7.2, permanentThreshold: 5, updatedAt: Date.now() })
    db.close()
    const bundle = await exportAll()
    expect(bundle.schemaVersion).toBe(1)
    expect(bundle.data.settings).toBeTruthy()
    expect((bundle.data.settings as any[]).length).toBe(1)
  })

  it('importAll merge: keeps existing + adds new', async () => {
    const db = await openDb()
    await db.put('categories', {
      id: 'cat-existing', name: '已有', type: 'expense',
      color: '#000', order: 0, createdAt: 0, updatedAt: 0, deletedAt: null
    })
    db.close()
    const bundle = {
      schemaVersion: 1,
      exportedAt: '2024-01-01',
      data: {
        categories: [{
          id: 'cat-new', name: '新增', type: 'expense',
          color: '#fff', order: 1, createdAt: 0, updatedAt: 0, deletedAt: null
        }]
      }
    } as any
    await importAll(bundle, 'merge')
    const db2 = await openDb()
    const all = await db2.getAll('categories')
    db2.close()
    expect(all.length).toBe(2)
  })

  it('importAll replace: clears then loads', async () => {
    const db = await openDb()
    await db.put('categories', {
      id: 'cat-a', name: 'A', type: 'expense',
      color: '#000', order: 0, createdAt: 0, updatedAt: 0, deletedAt: null
    })
    db.close()
    const bundle = {
      schemaVersion: 1,
      exportedAt: '2024-01-01',
      data: {
        categories: [{
          id: 'cat-b', name: 'B', type: 'expense',
          color: '#fff', order: 0, createdAt: 0, updatedAt: 0, deletedAt: null
        }]
      }
    } as any
    await importAll(bundle, 'replace')
    const db2 = await openDb()
    const all = await db2.getAll('categories')
    db2.close()
    expect(all.length).toBe(1)
    expect((all[0] as any).id).toBe('cat-b')
  })

  it('importAll rejects wrong version', async () => {
    await expect(importAll({ schemaVersion: 99, exportedAt: 'x', data: {} } as any, 'merge'))
      .rejects.toThrow()
  })
})
