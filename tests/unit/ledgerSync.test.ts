import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { resetDbForTests } from '@/repos/db'

// categoryRepo mock: 控制 list/add 行为
vi.mock('@/repos/categoryRepo', () => ({
  categoryRepo: {
    list: vi.fn(async () => []),
    add: vi.fn(async (input: { name: string }) => ({ id: 'cat-created-1', name: input.name, type: 'expense' as const, color: '#38bdf8', icon: '📈', order: 7, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null }))
  }
}))
vi.mock('@/repos/transactionRepo', () => ({
  transactionRepo: { add: vi.fn(async (input: Record<string, unknown>) => ({ id: 'txn-1', createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, ...input })) }
}))

import { syncInvestToLedger, resetInvestCategoryCache, holdingNote } from '@/lib/ledger-sync'
import { categoryRepo } from '@/repos/categoryRepo'
import { transactionRepo } from '@/repos/transactionRepo'

function wipeDb() {
  resetDbForTests()
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('func-db')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await wipeDb()
  vi.clearAllMocks()
  resetInvestCategoryCache()
})

afterEach(() => {
  vi.clearAllMocks()
  resetInvestCategoryCache()
})

describe('ledger-sync', () => {
  it('买入→支出/卖出→收入, 金额>0 才入账', async () => {
    vi.mocked(categoryRepo.list).mockResolvedValue([{ id: 'cat-inv', name: '投资', type: 'expense', color: '', icon: '', order: 7, createdAt: 1, updatedAt: 1, deletedAt: null } as never])
    const okBuy = await syncInvestToLedger({ amountFen: 10000, side: 'buy', date: '2026-10-06', note: '测试买入' })
    expect(okBuy).toBe(true)
    expect(transactionRepo.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'expense', amount: 10000, categoryId: 'cat-inv' }))

    const okSell = await syncInvestToLedger({ amountFen: 5000, side: 'sell', date: '2026-10-06', note: '测试卖出' })
    expect(okSell).toBe(true)
    expect(transactionRepo.add).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'income', amount: 5000 }))

    // 0 金额 / 负数 → 拒绝
    expect(await syncInvestToLedger({ amountFen: 0, side: 'buy', date: '2026-10-06', note: 'x' })).toBe(false)
    expect(await syncInvestToLedger({ amountFen: -100, side: 'buy', date: '2026-10-06', note: 'x' })).toBe(false)
    expect(transactionRepo.add).toHaveBeenCalledTimes(2)
  })

  it('并发单飞: 多笔同时触发只解析/创建一次分类', async () => {
    // list 慢速返回, 模拟窗口期并发
    vi.mocked(categoryRepo.list).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([]), 20)))
    const results = await Promise.all([
      syncInvestToLedger({ amountFen: 100, side: 'buy', date: '2026-10-06', note: 'a' }),
      syncInvestToLedger({ amountFen: 200, side: 'buy', date: '2026-10-06', note: 'b' }),
      syncInvestToLedger({ amountFen: 300, side: 'sell', date: '2026-10-06', note: 'c' })
    ])
    expect(results).toEqual([true, true, true])
    // 分类解析只发生一次 → list 只调一次, add (建分类) 只调一次
    expect(categoryRepo.list).toHaveBeenCalledTimes(1)
    expect(categoryRepo.add).toHaveBeenCalledTimes(1)
    // 三笔流水都写入且归到同一分类
    expect(transactionRepo.add).toHaveBeenCalledTimes(3)
  })

  it('分类解析失败不缓存 → 下次同步自动重试成功', async () => {
    vi.mocked(categoryRepo.list).mockRejectedValueOnce(new Error('IDB 瞬时故障'))
    const first = await syncInvestToLedger({ amountFen: 100, side: 'buy', date: '2026-10-06', note: '失败一笔' })
    expect(first).toBe(false)
    expect(transactionRepo.add).not.toHaveBeenCalled()

    // 恢复后重试成功 (不残留失败缓存)
    vi.mocked(categoryRepo.list).mockResolvedValue([])
    const second = await syncInvestToLedger({ amountFen: 100, side: 'buy', date: '2026-10-06', note: '重试成功' })
    expect(second).toBe(true)
    expect(transactionRepo.add).toHaveBeenCalledTimes(1)
  })

  it('resetInvestCategoryCache 后重新解析 (不残留旧用户 categoryId)', async () => {
    vi.mocked(categoryRepo.list).mockResolvedValue([{ id: 'cat-user-a', name: '投资', type: 'expense', color: '', icon: '', order: 7, createdAt: 1, updatedAt: 1, deletedAt: null } as never])
    await syncInvestToLedger({ amountFen: 100, side: 'buy', date: '2026-10-06', note: '用户A' })
    expect(categoryRepo.list).toHaveBeenCalledTimes(1)

    // 用户切换 → reset → 重新解析
    resetInvestCategoryCache()
    vi.mocked(categoryRepo.list).mockResolvedValue([{ id: 'cat-user-b', name: '投资', type: 'expense', color: '', icon: '', order: 7, createdAt: 1, updatedAt: 1, deletedAt: null } as never])
    await syncInvestToLedger({ amountFen: 100, side: 'buy', date: '2026-10-06', note: '用户B' })
    expect(categoryRepo.list).toHaveBeenCalledTimes(2)
    expect(transactionRepo.add).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: 'cat-user-b' }))
  })

  it('已有投资分类时直接复用不新建', async () => {
    vi.mocked(categoryRepo.list).mockResolvedValue([{ id: 'cat-existing', name: '投资', type: 'expense', color: '', icon: '', order: 7, createdAt: 1, updatedAt: 1, deletedAt: null } as never])
    const ok = await syncInvestToLedger({ amountFen: 100, side: 'buy', date: '2026-10-06', note: 'x' })
    expect(ok).toBe(true)
    expect(categoryRepo.add).not.toHaveBeenCalled()
  })

  it('holdingNote: 有名带名, 无名退 secid', () => {
    expect(holdingNote('恒生科技ETF华夏', '513180')).toBe('恒生科技ETF华夏(513180)')
    expect(holdingNote(undefined, 'QQQ')).toBe('QQQ')
    expect(holdingNote('', '510300')).toBe('510300')
  })
})
