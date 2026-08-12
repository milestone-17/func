import { openDb } from '@/repos/db'
import { newId, makeTimestamps, touchUpdated } from '@/repos/base'
import type { HoldingTxn } from '@/types/portfolio'

export const holdingTxnRepo = {
  async add(input: Omit<HoldingTxn, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<HoldingTxn> {
    const db = await openDb()
    const ts = makeTimestamps()
    const t: HoldingTxn = { id: newId(), ...input, ...ts }
    await db.add('holdingTxns', t)
    db.close()
    return t
  },
  async put(t: HoldingTxn): Promise<HoldingTxn> {
    const db = await openDb()
    const out = touchUpdated(t)
    await db.put('holdingTxns', out)
    db.close()
    return out
  },
  async listByHolding(holdingId: string): Promise<HoldingTxn[]> {
    const db = await openDb()
    const all = await db.getAll('holdingTxns') as HoldingTxn[]
    db.close()
    return all.filter(t => t.holdingId === holdingId && !t.deletedAt)
      .sort((a, b) => a.date.localeCompare(b.date))
  },
  async listAll(): Promise<HoldingTxn[]> {
    const db = await openDb()
    const all = await db.getAll('holdingTxns') as HoldingTxn[]
    db.close()
    return all.filter(t => !t.deletedAt)
  },
  /**
   * 重建持仓的成本与数量 (按日期升序遍历)
   * - buy 累加 cost += price * qty + fee; qty += qty
   * - sell 累减: cost -= avgCost * qty; qty -= qty
   * - dividend 累加 cost -= 现金分红; qty 不变
   *   (实操中股息不摊薄成本更常见,这里采用"现金分红"独立,不动平均成本)
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
      // dividend: 不动 cost,记录到 realizedDividend 单独统计
    }
    const avgCost = qty > 0 ? cost / qty : 0
    return { quantity: qty, avgCost: Math.round(avgCost * 100) / 100 }
  }
}
