import { makeRemoteRepo } from '@/repos/remote-base'
import type { HoldingTxn } from '@/types/portfolio'

const repo = makeRemoteRepo<HoldingTxn>('holdingTxns')

export const holdingTxnRepo = {
  async add(input: Omit<HoldingTxn, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<HoldingTxn> {
    return repo.add(input)
  },
  async put(t: HoldingTxn): Promise<HoldingTxn> {
    return repo.put(t)
  },
  async listByHolding(holdingId: string): Promise<HoldingTxn[]> {
    const all = await repo.list({ holdingId })
    return all.sort((a, b) => a.date.localeCompare(b.date))
  },
  async listAll(): Promise<HoldingTxn[]> {
    return repo.list()
  },
  /**
   * 重建持仓的成本与数量 (按日期升序遍历)
   * - buy 累加 cost += price * qty + fee; qty += qty
   * - sell 累减: cost -= avgCost * qty; qty -= qty
   * - dividend 现金分红独立统计, 不动平均成本
   */
  async computeAvgCost(holdingId: string): Promise<{ quantity: number; avgCost: number }> {
    const txns = await this.listByHolding(holdingId)
    let qty = 0
    let cost = 0
    for (const t of txns) {
      const q = t.quantity ?? 0
      if (t.side === 'buy') {
        cost += (t.price ?? 0) * q + (t.fee || 0)
        qty += q
      } else if (t.side === 'sell') {
        const avg = qty > 0 ? cost / qty : 0
        cost -= avg * q
        qty -= q
      }
    }
    const avgCost = qty > 0 ? cost / qty : 0
    return { quantity: qty, avgCost: Math.round(avgCost * 100) / 100 }
  }
}
