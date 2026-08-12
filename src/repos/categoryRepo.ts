import { openDb } from '@/repos/db'
import { newId, makeTimestamps, softDelete, touchUpdated } from '@/repos/base'
import type { Category } from '@/types/ledger'

export const categoryRepo = {
  async add(input: Omit<Category, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Category> {
    const db = await openDb()
    const ts = makeTimestamps()
    const c: Category = { id: newId(), ...input, ...ts }
    await db.add('categories', c)
    db.close()
    return c
  },
  async put(c: Category): Promise<Category> {
    const db = await openDb()
    const out = touchUpdated(c)
    await db.put('categories', out)
    db.close()
    return out
  },
  async list(): Promise<Category[]> {
    const db = await openDb()
    const all = await db.getAll('categories') as Category[]
    db.close()
    return all.filter(c => !c.deletedAt).sort((a, b) => a.order - b.order)
  },
  async softDelete(id: string): Promise<void> {
    const db = await openDb()
    const c = await db.get('categories', id) as Category | undefined
    if (c) await db.put('categories', softDelete(c))
    db.close()
  },
  /** 内置默认分类 seed (首次启动) */
  async seedIfEmpty(): Promise<void> {
    const list = await this.list()
    if (list.length > 0) return
    const defaults: Omit<Category, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>[] = [
      { name: '餐饮', type: 'expense', color: '#f87171', order: 0 },
      { name: '交通', type: 'expense', color: '#fb923c', order: 1 },
      { name: '购物', type: 'expense', color: '#fbbf24', order: 2 },
      { name: '居住', type: 'expense', color: '#a3e635', order: 3 },
      { name: '娱乐', type: 'expense', color: '#34d399', order: 4 },
      { name: '医疗', type: 'expense', color: '#22d3ee', order: 5 },
      { name: '其他', type: 'expense', color: '#94a3b8', order: 6 },
      { name: '工资', type: 'income', color: '#60a5fa', order: 0 },
      { name: '奖金', type: 'income', color: '#818cf8', order: 1 },
      { name: '其他收入', type: 'income', color: '#a78bfa', order: 2 }
    ]
    for (const d of defaults) await this.add(d)
  }
}
