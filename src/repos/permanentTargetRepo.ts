import { api } from '@/lib/api'
import { newId } from '@/repos/base'
import type { PermTarget, AssetType } from '@/types/permanent'

export const permanentTargetRepo = {
  async upsert(input: Omit<PermTarget, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { id?: string }): Promise<PermTarget> {
    const all = await this.list()
    const existing = all.find(t => t.assetType === input.assetType)
    const now = Date.now()
    if (existing) {
      const out: PermTarget = { ...existing, targetPercent: input.targetPercent, updatedAt: now }
      const r = await api.put<{ item: PermTarget }>(`/api/permanentTargets/${existing.id}`, out)
      return r.item
    }
    const entity = { id: newId(), ...input, createdAt: now, updatedAt: now, deletedAt: null } as unknown as PermTarget
    const r = await api.post<{ item: PermTarget }>('/api/permanentTargets', entity)
    return r.item
  },
  async list(): Promise<PermTarget[]> {
    const r = await api.get<{ items: PermTarget[] }>('/api/permanentTargets')
    return r.items.filter(t => !t.deletedAt)
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
