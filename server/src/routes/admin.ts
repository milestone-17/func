import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../plugins/auth'
import { syncMarketNow, setSourcePriority, getSourcePriority } from '../cron/market'
import { SOURCE_PRIORITY } from '../lib/market-fetcher'
import type { SourceId } from '../lib/market-fetcher'

const ADMIN_COOKIE = 'admin_token'

/** 独立 admin_token (HS256, 2h, payload.kind=admin) — 与用户 JWT 分离 */
function signAdminToken(secret: string, email: string): string {
  const b64 = (s: string) => Buffer.from(s).toString('base64url')
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const exp = Math.floor(Date.now() / 1000) + 2 * 3600
  const body = b64(JSON.stringify({ sub: email, kind: 'admin', exp }))
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function verifyAdminToken(secret: string, token: string): string | null {
  try {
    const [h, b, sig] = token.split('.')
    if (!h || !b || !sig) return null
    const expect = createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')
    const a = Buffer.from(sig)
    const e = Buffer.from(expect)
    if (a.length !== e.length || !timingSafeEqual(a, e)) return null
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString()) as { kind?: string; exp?: number; sub?: string }
    if (payload.kind !== 'admin' || !payload.exp || payload.exp * 1000 < Date.now()) return null
    return payload.sub || null
  } catch {
    return null
  }
}

/** 独立后台守卫: admin_token Cookie (不进用户站会话) */
async function requirePanel(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const secret = process.env.JWT_SECRET || ''
  const token = (req.cookies as Record<string, string | undefined>)[ADMIN_COOKIE]
  const email = token ? verifyAdminToken(secret, token) : null
  if (!email) {
    await reply.code(401).send({ error: '后台未登录' })
    return null
  }
  return email
}

/** handler 内取当前管理员邮箱 (preHandler=requirePanel 已确保 token 有效) */
function panelEmail(req: FastifyRequest): string {
  const token = (req.cookies as Record<string, string | undefined>)[ADMIN_COOKIE] || ''
  return verifyAdminToken(process.env.JWT_SECRET || '', token) || ''
}

/** 用户站 admin 接口守卫 (兼容保留) */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply)
  if (reply.sent) return
  const user = await prisma.user.findUnique({ where: { id: req.userId! } })
  if (!user || user.role !== 'admin') {
    await reply.code(403).send({ error: '需要管理员权限' })
  }
}

async function audit(actor: string, action: string, target?: string, detail?: Record<string, unknown>): Promise<void> {
  await prisma.adminAudit.create({
    data: { actor, action, target: target ?? null, detail: detail ? (detail as Prisma.InputJsonValue) : Prisma.JsonNull }
  }).catch(() => {})
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ===== 独立后台登录 =====
  app.post('/api/admin/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { email, password } = (req.body || {}) as { email?: string; password?: string }
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase()
    if (!adminEmail || !email || email.toLowerCase() !== adminEmail) {
      return reply.code(403).send({ error: '该邮箱不是管理员' })
    }
    const user = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (!user) return reply.code(403).send({ error: '管理员账号未初始化' })
    const { verify: argonVerify } = await import('@node-rs/argon2')
    if (user.passwordHash) {
      const ok = await argonVerify(user.passwordHash, password || '')
      if (!ok) return reply.code(401).send({ error: '密码错误' })
    } else {
      return reply.code(401).send({ error: '密码错误' })
    }
    const token = signAdminToken(process.env.JWT_SECRET || '', adminEmail)
    reply.setCookie(ADMIN_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 2 * 3600 })
    await audit(adminEmail, 'login')
    return { ok: true }
  })

  app.post('/api/admin/auth/logout', async (req, reply) => {
    const email = (req.cookies as Record<string, string | undefined>)[ADMIN_COOKIE]
      ? verifyAdminToken(process.env.JWT_SECRET || '', (req.cookies as Record<string, string | undefined>)[ADMIN_COOKIE] || '')
      : null
    reply.clearCookie(ADMIN_COOKIE, { path: '/' })
    if (email) await audit(email, 'logout')
    return { ok: true }
  })

  // 后台专用接口 (admin_token 鉴权) =====
  app.get('/api/admin/panel/summary', { preHandler: requirePanel }, async (req) => {
    const [totalUsers, guestUsers, disabledUsers, activeToday] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { provider: 'guest' } }),
      prisma.user.count({ where: { disabled: true } }),
      prisma.user.count({ where: { lastSeenAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } } })
    ])
    const [txCount, holdingCount, fundHistRows] = await Promise.all([
      prisma.transaction.count({ where: { deletedAt: null } }),
      prisma.holding.count({ where: { deletedAt: null } }),
      prisma.fundNavHistory.count()
    ])
    const indexRows = await prisma.indexData.count()
    const latest = await prisma.indexData.findFirst({ orderBy: { date: 'desc' } })
    const dcaFunds = await prisma.dcaFund.count({ where: { deletedAt: null } })
    return {
      users: { total: totalUsers, guests: guestUsers, disabled: disabledUsers, activeToday },
      data: { transactions: txCount, holdings: holdingCount, indexRows, fundHistRows, dcaFunds },
      market: {
        latestDate: latest?.date ?? null,
        latestSource: (latest?.data as { source?: string } | null)?.source ?? null,
        sourcePriority: getSourcePriority()
      }
    }
  })

  // 源优先级配置
  app.post('/api/admin/panel/source-priority', { preHandler: requirePanel }, async (req, reply) => {
    const { priority } = (req.body || {}) as { priority?: SourceId[] }
    if (!Array.isArray(priority) || priority.length !== SOURCE_PRIORITY.length) {
      return reply.code(400).send({ error: 'priority 需为全部源的全排列' })
    }
    setSourcePriority(priority)
    await audit(panelEmail(req), 'set_source_priority', undefined, { priority })
    return { ok: true, priority: getSourcePriority() }
  })

  // 审计日志
  app.get('/api/admin/panel/audit', { preHandler: requirePanel }, async (req) => {
    const q = (req.query || {}) as { limit?: string }
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
    const items = await prisma.adminAudit.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
    return { items }
  })

  // 用户管理 (后台复用, 鉴权改 admin_token)
  app.get('/api/admin/panel/users', { preHandler: requirePanel }, async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, provider: true, role: true, disabled: true,
        emailVerified: true, createdAt: true, lastSeenAt: true, lastImportAt: true
      }
    })
    return { items: users }
  })

  // 基金池 (全站定投基金目录)
  app.get('/api/admin/panel/fund-pool', { preHandler: requirePanel }, async () => {
    const rows = await prisma.dcaFund.findMany({
      where: { deletedAt: null },
      select: { code: true, name: true, createdAt: true },
      distinct: ['code']
    })
    const histCounts = await prisma.fundNavHistory.groupBy({ by: ['code'], _count: { code: true } })
    const countMap = new Map(histCounts.map(h => [h.code, h._count.code]))
    return { items: rows.map(r => ({ ...r, histRows: countMap.get(r.code) || 0 })) }
  })

  app.delete('/api/admin/panel/fund-pool/:code', { preHandler: requirePanel }, async (req, reply) => {
    const { code } = req.params as { code: string }
    await prisma.dcaFund.updateMany({ where: { code }, data: { deletedAt: new Date() } })
    await audit(panelEmail(req), 'remove_fund_pool', code)
    return { ok: true }
  })

  // 后台用户禁用/启用
  app.patch('/api/admin/panel/users/:id', { preHandler: requirePanel }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { disabled } = (req.body || {}) as { disabled?: boolean }
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return reply.code(404).send({ error: '用户不存在' })
    if (user.role === 'admin') return reply.code(400).send({ error: '不能禁用管理员' })
    await prisma.user.update({ where: { id }, data: { disabled: !!disabled } })
    await audit(panelEmail(req), disabled ? 'disable_user' : 'enable_user', id)
    return { ok: true }
  })

  // 后台删除用户 (软删全部数据 + 匿名化)
  app.delete('/api/admin/panel/users/:id', { preHandler: requirePanel }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return reply.code(404).send({ error: '用户不存在' })
    if (user.role === 'admin') return reply.code(400).send({ error: '不能删除管理员' })
    const now = new Date()
    await prisma.$transaction([
      prisma.transaction.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.holding.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.holdingTxn.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.budget.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.category.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.dcaConfig.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.dcaExecution.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.dailyDcaConfig.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.permanentTarget.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.appSetting.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.metaEntry.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.valuationSnapshot.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.dcaFund.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.user.update({ where: { id }, data: { disabled: true, email: `deleted-${id.slice(0, 8)}@deleted.local`, passwordHash: null, githubId: null } })
    ])
    await audit(panelEmail(req), 'delete_user', id)
    return { ok: true }
  })

  // 后台手动同步行情
  app.post('/api/admin/panel/sync-market', { preHandler: requirePanel }, async (req, reply) => {
    const r = await syncMarketNow()
    await audit(panelEmail(req), 'sync_market', undefined, { rows: r.rows, source: r.source })
    return { ok: r.rows > 0, rows: r.rows, source: r.source }
  })

  // ===== 用户站 admin 接口 (JWT, 兼容保留) =====
  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, provider: true, role: true, disabled: true,
        emailVerified: true, createdAt: true, lastSeenAt: true, lastImportAt: true
      }
    })
    return { items: users }
  })

  app.post('/api/admin/users/:id/disable', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return reply.code(404).send({ error: '用户不存在' })
    if (user.role === 'admin') return reply.code(400).send({ error: '不能禁用管理员' })
    await prisma.user.update({ where: { id }, data: { disabled: true } })
    return { ok: true }
  })

  app.post('/api/admin/users/:id/enable', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return reply.code(404).send({ error: '用户不存在' })
    await prisma.user.update({ where: { id }, data: { disabled: false } })
    return { ok: true }
  })

  app.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return reply.code(404).send({ error: '用户不存在' })
    if (user.role === 'admin') return reply.code(400).send({ error: '不能删除管理员' })
    const now = new Date()
    await prisma.$transaction([
      prisma.transaction.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.holding.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.holdingTxn.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.budget.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.category.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.dcaConfig.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.dcaExecution.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.dailyDcaConfig.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.permanentTarget.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.appSetting.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.metaEntry.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.valuationSnapshot.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.dcaFund.updateMany({ where: { userId: id }, data: { deletedAt: now } }),
      prisma.user.update({ where: { id }, data: { disabled: true, email: `deleted-${id.slice(0, 8)}@deleted.local`, passwordHash: null, githubId: null } })
    ])
    return { ok: true }
  })

  app.get('/api/admin/stats', { preHandler: requireAdmin }, async () => {
    const [totalUsers, guestUsers, disabledUsers, todayStart] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { provider: 'guest' } }),
      prisma.user.count({ where: { disabled: true } }),
      Promise.resolve(new Date(new Date().toISOString().slice(0, 10)))
    ])
    const activeToday = await prisma.user.count({ where: { lastSeenAt: { gte: todayStart } } })
    const [txCount, holdingCount, holdingTxnCount] = await Promise.all([
      prisma.transaction.count({ where: { deletedAt: null } }),
      prisma.holding.count({ where: { deletedAt: null } }),
      prisma.holdingTxn.count({ where: { deletedAt: null } })
    ])
    const indexRows = await prisma.indexData.count()
    return {
      users: { total: totalUsers, guests: guestUsers, disabled: disabledUsers, activeToday },
      data: { transactions: txCount, holdings: holdingCount, holdingTxns: holdingTxnCount, indexRows }
    }
  })

  app.post('/api/admin/market/sync', { preHandler: requireAdmin }, async () => {
    const r = await syncMarketNow()
    return { ok: r.rows > 0, rows: r.rows, source: r.source }
  })
}
