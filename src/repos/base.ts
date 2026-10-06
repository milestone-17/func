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
  // crypto.randomUUID 仅在安全上下文 (HTTPS/localhost) 可用, HTTP+IP 部署需降级
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
