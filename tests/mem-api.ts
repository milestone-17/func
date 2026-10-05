/**
 * 测试环境内存 API Mock
 * - 拦截 /api/* 请求, 提供与 server 相同语义的内存实现
 * - 每个测试文件内的 fetch mock 是独立实例
 */
type Row = Record<string, any>

interface MemoryDb {
  users: Row[]
  currentUser: string | null
  tables: Map<string, Map<string, Row>>
}

function getDb(): MemoryDb {
  const g = globalThis as any
  if (!g.__funcMemDb) {
    g.__funcMemDb = {
      users: [],
      currentUser: 'u1',
      tables: new Map<string, Map<string, Row>>()
    }
  }
  return g.__funcMemDb
}

function table(name: string): Map<string, Row> {
  const db = getDb()
  if (!db.tables.has(name)) db.tables.set(name, new Map())
  return db.tables.get(name)!
}

/** 每个测试文件开始时调用: 重置内存库并安装 fetch mock */
export function installMemApi(): void {
  const db = getDb()
  db.users = [{ id: 'u1', email: 'u1@test.com', provider: 'email' }]
  db.currentUser = 'u1'
  db.tables = new Map()

  const realFetch = globalThis.fetch
  const g = globalThis as any
  if (!g.__funcRealFetch) g.__funcRealFetch = realFetch

  const mockedFetch = async function (input: any, init?: any): Promise<Response> {
    const rawUrl = typeof input === 'string' ? input : input?.url || ''
    const method = (init?.method || 'GET').toUpperCase()
    if (!rawUrl.startsWith('/api/')) {
      return g.__funcRealFetch(input, init)
    }
    const url = rawUrl.split('?')[0]

    const json = (data: unknown, status = 200): Response =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

    const body: Row = init?.body ? JSON.parse(init.body) : {}

    // auth
    if (url === '/api/me' && method === 'GET') {
      const u = db.users.find(x => x.id === db.currentUser)
      return json({ user: u ? { id: u.id, email: u.email, provider: u.provider } : null })
    }

    // import
    if (url === '/api/import' && method === 'POST') {
      if (!db.currentUser) return json({ error: '未登录' }, 401)
      if (body.schemaVersion !== 1 || !body.data) return json({ error: '备份格式不合法' }, 400)
      const summary: Record<string, number> = {}
      for (const [store, rows] of Object.entries(body.data as Record<string, Row[]>)) {
        if (!Array.isArray(rows)) continue
        for (const r of rows) {
          if (!r?.id) continue
          upsert(store, r)
        }
        summary[store] = rows.length
      }
      return json({ ok: true, summary })
    }

    // resource CRUD: /api/:resource[/:id]
    const m = url.match(/^\/api\/(?!auth\/|me$|import$|market\/|market$)([a-zA-Z]+)(?:\/(.+))?$/)
    if (m) {
      if (!db.currentUser) return json({ error: '未登录' }, 401)
      const resource = m[1]
      const id = m[2]
      if (method === 'GET' && !id) {
        // 按 query 过滤 (与服务端 filter 列语义一致)
        const qs = rawUrl.split('?')[1] || ''
        const params = new URLSearchParams(qs)
        let rows = [...table(resource).values()].filter(r => !r.deletedAt)
        for (const [k, v] of params.entries()) {
          rows = rows.filter(r => String(r[k]) === v)
        }
        return json({ items: rows })
      }
      if (method === 'POST' && !id) {
        if (!body.id) return json({ error: '缺少 id' }, 400)
        upsert(resource, body)
        return json({ item: body })
      }
      if (method === 'GET' && id) {
        const key = decodeURIComponent(id)
        const row = table(resource).get(key)
        if (!row) return json({ error: '不存在' }, 404)
        return json({ item: row })
      }
      if (method === 'PUT' && id) {
        const key = decodeURIComponent(id)
        const row = table(resource).get(key)
        if (!row) return json({ error: '不存在' }, 404)
        const merged = { ...row, ...body }
        table(resource).set(key, merged)
        return json({ item: merged })
        }
      if (method === 'DELETE' && id) {
        const key = decodeURIComponent(id)
        const row = table(resource).get(key)
        if (!row) return json({ error: '不存在' }, 404)
        row.deletedAt = Date.now()
        row.updatedAt = Date.now()
        return json({ ok: true })
      }
    }

    return json({ error: `mock 未实现: ${method} ${url}` }, 404)
  }

  // 安装 mock + 暴露句柄 (测试内 stubGlobal 覆盖后, 转发 /api/* 用 __funcApiFetch)
  g.fetch = mockedFetch
  g.__funcApiFetch = mockedFetch
}

function upsert(store: string, row: Row): void {
  // 归一化时间戳
  const out = { ...row }
  if (typeof out.createdAt === 'number') out.createdAt = out.createdAt
  const t = table(store)
  const existing = t.get(out.id)
  t.set(out.id, existing ? { ...existing, ...out } : out)
}

/** 测试里手动登录 (内存态) */
export function memLogin(userId: string = 'u1'): void {
  const db = getDb()
  let u = db.users.find(x => x.id === userId)
  if (!u) {
    u = { id: userId, email: `${userId}@test.com`, provider: 'email' }
    db.users.push(u)
  }
  db.currentUser = userId
}

/** 直接向内存库写数据 */
export function memSeed(store: string, row: Row): void {
  upsert(store, row)
}
