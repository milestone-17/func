import { describe, it, expect, beforeEach } from 'vitest'
import { exportAll, importAll, isValidBundle, downloadBackup } from '@/lib/backup'
import { categoryRepo } from '@/repos/categoryRepo'
import { transactionRepo } from '@/repos/transactionRepo'
import { resetDbForTests } from '@/repos/db'

beforeEach(() => {
  resetDbForTests()
})

describe('backup (云端语义)', () => {
  it('exportAll 返回含全部 store 键的 bundle', async () => {
    await categoryRepo.add({ name: '餐饮', type: 'expense', color: '#f87171', icon: '🍜', order: 0 })
    const bundle = await exportAll()
    expect(bundle.schemaVersion).toBe(1)
    expect(typeof bundle.exportedAt).toBe('string')
    for (const key of ['transactions', 'categories', 'budgets', 'holdings', 'settings']) {
      expect(Array.isArray(bundle.data[key])).toBe(true)
    }
    expect((bundle.data.categories as unknown[]).length).toBe(1)
  })

  it('importAll 幂等合并: 重复导入不产生重复行', async () => {
    const bundle = await exportAll()
    ;(bundle.data.categories as unknown[]).push({
      id: 'cat-x', name: '测试分类', type: 'expense', color: '#fff', icon: '🧪', order: 99,
      createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null
    })
    await importAll(bundle, 'merge')
    await importAll(bundle, 'merge')
    const all = await categoryRepo.list()
    const xs = all.filter(c => c.id === 'cat-x')
    expect(xs.length).toBe(1)
  })

  it('交易通过 import 落库可读回', async () => {
    const t = {
      id: 'tx-imp-1', date: '2026-01-01', type: 'expense', categoryId: 'c1', amount: 100,
      note: 'imported', createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null
    }
    await importAll({ schemaVersion: 1, exportedAt: new Date().toISOString(), data: { transactions: [t] } }, 'merge')
    const list = await transactionRepo.list()
    expect(list.find(x => x.id === 'tx-imp-1')).toBeDefined()
  })

  it('版本不合法 → 拒绝', async () => {
    await expect(importAll({ schemaVersion: 99, exportedAt: 'x', data: {} } as never)).rejects.toThrow()
  })

  it('isValidBundle 校验', () => {
    expect(isValidBundle({ schemaVersion: 1, exportedAt: 'x', data: {} })).toBe(true)
    expect(isValidBundle({ exportedAt: 'x' })).toBe(false)
    expect(isValidBundle(null)).toBe(false)
  })

  it('downloadBackup 不抛错 (浏览器 API 由 happy-dom 提供)', () => {
    expect(() => downloadBackup()).not.toThrow()
  })
})
