/**
 * 远程 Repository 基类
 * - 与 IndexedDB 版接口兼容 (add/put/get/softDelete/list)
 * - 数据通过 REST API 读写, 服务端按 user_id 隔离
 */
import { api, type ListResp, type ItemResp } from '@/lib/api'
import { newId, makeTimestamps } from '@/repos/base'

export function makeRemoteRepo<T extends { id: string; createdAt: number; updatedAt: number; deletedAt?: number | null }>(resource: string) {
  return {
    /** 生成新 id (与本地版一致) */
    newId,

    async add(input: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<T> {
      const ts = makeTimestamps()
      const entity = { id: newId(), ...input, ...ts } as unknown as T
      const r = await api.post<ItemResp<T>>(`/api/${resource}`, entity)
      return r.item
    },

    async put(entity: T): Promise<T> {
      const out = { ...entity, updatedAt: Date.now() }
      const r = await api.put<ItemResp<T>>(`/api/${resource}/${entity.id}`, out)
      return r.item
    },

    async get(id: string): Promise<T | undefined> {
      try {
        const r = await api.get<ItemResp<T>>(`/api/${resource}/${id}`)
        return r.item
      } catch (e) {
        if ((e as { status?: number }).status === 404) return undefined
        throw e
    }
    },

    async softDelete(id: string): Promise<void> {
      await api.delete(`/api/${resource}/${id}`)
    },

    async list(filter: Record<string, string> = {}): Promise<T[]> {
      const qs = new URLSearchParams(filter).toString()
      const path = qs ? `/api/${resource}?${qs}` : `/api/${resource}`
      const r = await api.get<ListResp<T>>(path)
      return r.items.filter(x => !x.deletedAt)
    }
  }
}
