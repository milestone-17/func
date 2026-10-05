/**
 * 统一 API 客户端
 * - 同源 fetch, 带 Cookie
 * - 401 自动跳登录页
 * - 统一错误格式
 */

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 401 时跳转登录(带 redirect 参数), 由 authStore 注册 */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}
function handleUnauthorized(): void {
  if (onUnauthorized) onUnauthorized()
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  if (res.status === 401) {
    handleUnauthorized()
    throw new ApiError(401, '未登录或会话已过期')
  }
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch { /* non-json */ }
    throw new ApiError(res.status, msg)
  }
  return (await res.json()) as T
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>('GET', path)
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('POST', path, body)
  },
  put<T>(path: string, body: unknown): Promise<T> {
    return request<T>('PUT', path, body)
  },
  delete<T>(path: string): Promise<T> {
    return request<T>('DELETE', path)
  }
}

/** 列表响应 */
export interface ListResp<T> { items: T[] }
/** 单条响应 */
export interface ItemResp<T> { item: T }
/** 导入摘要 */
export interface ImportSummary { [store: string]: number }
export interface ImportResp { ok: boolean; summary: ImportSummary }

export interface CurrentUser { id: string; email: string; provider: string }
