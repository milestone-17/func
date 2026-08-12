/**
 * 通用 Repository 模式
 * - add / get / put / delete (软删) / list
 * - 软删: 设置 deletedAt 字段
 */
export interface WithId { id: string; deletedAt?: number | null }
export interface WithTimestamps {
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

export function nowMs(): number {
  return Date.now()
}

export function makeTimestamps(): WithTimestamps {
  const t = nowMs()
  return { createdAt: t, updatedAt: t, deletedAt: null }
}

export function touchUpdated<T extends WithTimestamps>(entity: T): T {
  return { ...entity, updatedAt: nowMs() }
}

export function softDelete<T extends WithTimestamps>(entity: T): T {
  return { ...entity, deletedAt: nowMs(), updatedAt: nowMs() }
}

export function newId(): string {
  return crypto.randomUUID()
}
