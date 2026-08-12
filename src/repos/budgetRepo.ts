import { openDb } from '@/repos/db'
import { newId, touchUpdated } from '@/repos/base'
import type { BudgetPlan } from '@/types/budget'

export const budgetRepo = {
  async upsert(plan: Omit<BudgetPlan, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { id?: string }): Promise<BudgetPlan> {
    const db = await openDb()
    const existing = plan.id ? await db.get('budgets', plan.id) as BudgetPlan | undefined : undefined
    const now = Date.now()
    const out: BudgetPlan = existing
      ? touchUpdated({ ...existing, ...plan })
      : { id: plan.id || newId(), ...plan, createdAt: now, updatedAt: now, deletedAt: null }
    await db.put('budgets', out)
    db.close()
    return out
  },
  async getForMonth(month: string): Promise<BudgetPlan | undefined> {
    const db = await openDb()
    const all = await db.getAll('budgets') as BudgetPlan[]
    db.close()
    return all.find(p => p.month === month && !p.deletedAt)
  },
  async list(): Promise<BudgetPlan[]> {
    const db = await openDb()
    const all = await db.getAll('budgets') as BudgetPlan[]
    db.close()
    return all.filter(p => !p.deletedAt).sort((a, b) => b.month.localeCompare(a.month))
  },
  /**
   * 把每月剩余资金按分配规则自动拆到 4 周 (默认均分)
   */
  computeWeeklySplits(plan: Pick<BudgetPlan, 'allocations'>): [number, number, number, number] {
    const remaining = plan.allocations
      .filter(a => a.type === 'savings' || a.type === 'investment')
      .reduce((s, a) => s + a.amountFen, 0)
    if (remaining <= 0) return [0, 0, 0, 0]
    return [0.25, 0.25, 0.25, 0.25].map(p => Math.round(remaining * p)) as [number, number, number, number]
  }
}
