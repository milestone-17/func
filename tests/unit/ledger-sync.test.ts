import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock repos
const addTxnMock = vi.fn().mockResolvedValue({})
const listCatsMock = vi.fn().mockResolvedValue([])
const addCatMock = vi.fn().mockImplementation(c => Promise.resolve({ id: 'cat-invest-1', color: '', order: 7, createdAt: 1, updatedAt: 1, deletedAt: null, ...c }))

vi.mock('@/repos/transactionRepo', () => ({
  transactionRepo: { add: (...a: unknown[]) => addTxnMock(...a) }
}))
vi.mock('@/repos/categoryRepo', () => ({
  categoryRepo: {
    list: () => listCatsMock(),
    add: (...a: unknown[]) => addCatMock(...a)
  }
}))
vi.mock('@/repos/base', () => ({ newId: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) }))

import { holdingNote } from '@/lib/ledger-sync'

describe('投资 → 账本同步', () => {
  beforeEach(() => {
    addTxnMock.mockClear()
    addCatMock.mockClear()
    listCatsMock.mockResolvedValue([])
    // 重置模块级分类缓存
    vi.resetModules()
  })

  it('buy → 账本支出, 自动建「投资」分类', async () => {
    const { syncInvestToLedger: sync } = await import('@/lib/ledger-sync')
    const ok = await sync({ amountFen: 14000, side: 'buy', date: '2026-10-06', note: '加仓 恒生科技ETF(513180)' })
    expect(ok).toBe(true)
    expect(addCatMock).toHaveBeenCalledWith(expect.objectContaining({ name: '投资', type: 'expense' }))
    expect(addTxnMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'expense',
      amount: 14000,
      categoryId: 'cat-invest-1',
      date: '2026-10-06'
    }))
  })

  it('sell → 账本收入', async () => {
    const { syncInvestToLedger: sync } = await import('@/lib/ledger-sync')
    const ok = await sync({ amountFen: 5000, side: 'sell', date: '2026-10-06', note: '减仓' })
    expect(ok).toBe(true)
    expect(addTxnMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'income', amount: 5000 }))
  })

  it('已有「投资」分类时复用不重建', async () => {
    listCatsMock.mockResolvedValue([
      { id: 'cat-exist', name: '投资', type: 'expense', color: '', order: 9, createdAt: 1, updatedAt: 1, deletedAt: null }
    ])
    const { syncInvestToLedger: sync } = await import('@/lib/ledger-sync')
    await sync({ amountFen: 100, side: 'buy', date: '2026-10-06', note: 'x' })
    expect(addCatMock).not.toHaveBeenCalled()
    expect(addTxnMock).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-exist' }))
  })

  it('金额 ≤ 0 不同步', async () => {
    const { syncInvestToLedger: sync } = await import('@/lib/ledger-sync')
    const ok = await sync({ amountFen: 0, side: 'buy', date: '2026-10-06', note: '跳过' })
    expect(ok).toBe(false)
    expect(addTxnMock).not.toHaveBeenCalled()
  })

  it('账本写入失败静默返回 false (不阻断持仓主流程)', async () => {
    addTxnMock.mockRejectedValueOnce(new Error('network'))
    const { syncInvestToLedger: sync } = await import('@/lib/ledger-sync')
    const ok = await sync({ amountFen: 100, side: 'buy', date: '2026-10-06', note: 'x' })
    expect(ok).toBe(false)
  })

  it('holdingNote: 有名称带名称, 无名称仅代码', () => {
    expect(holdingNote('恒生科技ETF', '513180')).toBe('恒生科技ETF(513180)')
    expect(holdingNote(undefined, '513180')).toBe('513180')
  })
})
