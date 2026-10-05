import { makeRemoteRepo } from '@/repos/remote-base'
import type { Category } from '@/types/ledger'

const repo = makeRemoteRepo<Category>('categories')

export const categoryRepo = {
  async add(input: Omit<Category, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Category> {
    return repo.add(input)
  },
  async put(c: Category): Promise<Category> {
    return repo.put(c)
  },
  async list(): Promise<Category[]> {
    const all = await repo.list()
    return all.sort((a, b) => a.order - b.order)
  },
  async softDelete(id: string): Promise<void> {
    return repo.softDelete(id)
  },
  /** 内置默认分类 seed (首次启动) */
  async seedIfEmpty(): Promise<void> {
    const list = await this.list()
    if (list.length > 0) return
    const defaults: Omit<Category, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>[] = [
      { name: '餐饮', type: 'expense', color: '#f87171', icon: '🍜', order: 0 },
      { name: '交通', type: 'expense', color: '#fb923c', icon: '🚌', order: 1 },
      { name: '购物', type: 'expense', color: '#fbbf24', icon: '🛍️', order: 2 },
      { name: '居住', type: 'expense', color: '#a3e635', icon: '🏠', order: 3 },
      { name: '娱乐', type: 'expense', color: '#34d399', icon: '🎮', order: 4 },
      { name: '医疗', type: 'expense', color: '#22d3ee', icon: '💊', order: 5 },
      { name: '其他', type: 'expense', color: '#94a3b8', icon: '📝', order: 6 },
      { name: '工资', type: 'income', color: '#60a5fa', icon: '💰', order: 0 },
      { name: '奖金', type: 'income', color: '#818cf8', icon: '🎁', order: 1 },
      { name: '其他收入', type: 'income', color: '#a78bfa', icon: '➕', order: 2 }
    ]
    for (const d of defaults) await this.add(d)
  }
}
