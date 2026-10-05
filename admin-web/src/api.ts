/**
 * 管理后台 API 客户端 (admin_token Cookie 鉴权)
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('admin:unauthorized'))
    throw new ApiError(401, '后台未登录或会话已过期')
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

export interface PanelSummary {
  users: { total: number; guests: number; disabled: number; activeToday: number }
  data: { transactions: number; holdings: number; indexRows: number; fundHistRows: number; dcaFunds: number }
  market: { latestDate: string | null; latestSource: string | null; sourcePriority: string[] }
}

export interface PanelUser {
  id: string
  email: string
  provider: string
  role: string | null
  disabled: boolean
  emailVerified: boolean
  createdAt: string
  lastSeenAt: string | null
  lastImportAt: string | null
}

export interface AuditItem {
  id: string
  actor: string
  action: string
  target: string | null
  detail: unknown
  createdAt: string
}

export interface FundPoolItem {
  code: string
  name: string
  createdAt: string
  histRows: number
}

export interface FundSearchItem { code: string; name: string; type: string }

export const adminApi = {
  async login(email: string, password: string): Promise<void> {
    await request('POST', '/api/admin/auth/login', { email, password })
  },
  async logout(): Promise<void> {
    await request('POST', '/api/admin/auth/logout')
  },
  summary(): Promise<PanelSummary> {
    return request('GET', '/api/admin/panel/summary')
  },
  users(): Promise<{ items: PanelUser[] }> {
    return request('GET', '/api/admin/panel/users')
  },
  setUserEnabled(id: string, disabled: boolean): Promise<{ ok: boolean }> {
    return request('PATCH', `/api/admin/panel/users/${id}`, { disabled })
  },
  deleteUser(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/api/admin/panel/users/${id}`)
  },
  audit(limit = 50): Promise<{ items: AuditItem[] }> {
    return request('GET', `/api/admin/panel/audit?limit=${limit}`)
  },
  fundPool(): Promise<{ items: FundPoolItem[] }> {
    return request('GET', '/api/admin/panel/fund-pool')
  },
  removeFund(code: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/api/admin/panel/fund-pool/${code}`)
  },
  setSourcePriority(priority: string[]): Promise<{ ok: boolean; priority: string[] }> {
    return request('POST', '/api/admin/panel/source-priority', { priority })
  },
  syncMarket(): Promise<{ ok: boolean; rows: number; source: string | null }> {
    return request('POST', '/api/admin/panel/sync-market')
  },
  searchFunds(key: string): Promise<{ items: FundSearchItem[] }> {
    return request('GET', `/api/market/fund-search?key=${encodeURIComponent(key)}`)
  }
}

export function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleString('zh-CN', {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return String(v)
  }
}
