import { makeRemoteRepo } from '@/repos/remote-base'
import { newId } from '@/repos/base'
import type { BudgetPlan } from '@/types/budget'

const repo = makeRemoteRepo<BudgetPlan>('budgets')

export const budgetRepo = {
  async upsert(plan: Omit<BudgetPlan, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { id?: string }): Promise<BudgetPlan> {
    if (plan.id) {
      const existing = await repo.get(plan.id)
      if (existing) {
        return repo.put({ ...existing, ...plan } as BudgetPlan)
      }
    }
    const byMonth = await repo.list(plan.month ? { month: plan.month } : {})
    const hit = byMonth.find(p => p.month === plan.month)
    if (hit) {
      return repo.put({ ...hit, ...plan } as BudgetPlan)
    }
    const ts = Date.now()
    const entity = { id: plan.id || newId(), ...plan, createdAt: ts, updatedAt: ts, deletedAt: null } as unknown as BudgetPlan
    const { api } = await import('@/lib/api')
    const r = await api.post<{ item: BudgetPlan }>('/api/budgets', entity)
    return r.item
  },
  async getForMonth(month: string): Promise<BudgetPlan | undefined> {
    const all = await repo.list({ month })
    return all.find(p => p.month === month)
  },
  async list(): Promise<BudgetPlan[]> {
    const all = await repo.list()
    return all.sort((a, b) => b.month.localeCompare(a.month))
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
