import { openDb } from '@/repos/db'
import { newId, touchUpdated } from '@/repos/base'
import type { PermTarget, AssetType } from '@/types/permanent'

export const permanentTargetRepo = {
  async upsert(input: Omit<PermTarget, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { id?: string }): Promise<PermTarget> {
    const db = await openDb()
    const all = await db.getAll('permanentTargets') as PermTarget[]
    const existing = all.find(t => t.assetType === input.assetType && !t.deletedAt)
    const now = Date.now()
    const out: PermTarget = existing
      ? touchUpdated({ ...existing, targetPercent: input.targetPercent })
      : { id: newId(), ...input, createdAt: now, updatedAt: now, deletedAt: null }
    await db.put('permanentTargets', out)
    db.close()
    return out
  },
  async list(): Promise<PermTarget[]> {
    const db = await openDb()
    const all = await db.getAll('permanentTargets') as PermTarget[]
    db.close()
    return all.filter(t => !t.deletedAt)
  },
  /** 经典 25/25/25/25 seed */
  async seedDefault(): Promise<void> {
    const list = await this.list()
    if (list.length > 0) return
    const types: AssetType[] = ['stock', 'bond', 'cash', 'gold']
    for (const t of types) {
      await this.upsert({ assetType: t, targetPercent: 25 })
    }
  }
}
