import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../plugins/auth'
import { syncMarketNow, setSourcePriority, getSourcePriority } from '../cron/market'
import { SOURCE_PRIORITY, getSourceHealthSnapshot } from '../lib/market-fetcher'
import type { SourceId } from '../lib/market-fetcher'
import { savePriorityToDb } from '../lib/source-config'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** 主项目 package.json 路径 (server 的上一级) */
const pkgVersionPath = path.resolve(process.cwd(), '../package.json')

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
export async function requirePanel(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
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

// ===== git 提交扫描与记录同步 (git → releases / pitfalls) =====

const REPO_DIR = path.resolve(process.cwd(), '..')
const PKG_PATH = path.resolve(process.cwd(), '../package.json')
const execFileAsync = promisify(execFile)

interface GitCommit { hash: string; first: string; full: string; author: string; date: string }

/** 解析 git log --pretty=format:%h%x1f%s%x1f%B%x1e%an%x1f%ci 的原始输出 (导出供测试) */
export function parseGitLog(raw: string): GitCommit[] {
  const out: GitCommit[] = []
  for (const seg of raw.split('\u001e')) {
    if (!seg.trim()) continue
    const parts = seg.split('\u001f')
    const hash = parts[0] || ''
    if (!hash) continue
    const first = parts[1] || ''
    // %B 正文可能含控制字符: 作者/日期取末两段, 中间全部归回 full (保证 author/date 不被正文污染)
    const author = parts.length >= 5 ? parts[parts.length - 2] : ''
    const date = parts.length >= 5 ? parts[parts.length - 1] : ''
    const full = parts.length >= 5 ? parts.slice(2, parts.length - 2).join('\u001f') : parts[2] || ''
    out.push({ hash: hash.trim(), first, full, author, date })
  }
  return out
}

/** 读取仓库最近提交 (失败返回空数组, 不影响主流程) */
async function gitLogSince(limit = 400): Promise<GitCommit[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', REPO_DIR, 'log', '--pretty=format:%h%x1f%s%x1f%B%x1f%an%x1f%ci%x1e', `-n${limit}`]
    )
    return parseGitLog(stdout)
  } catch {
    return []
  }
}

/** 版本号 patch 位递增, 跳过已存在的版本 (导出供测试): 1.2.3 + {1.2.3,1.2.4} → 1.2.5 */
export function nextVersion(version: string, existing: Set<string>): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!m) return version
  let [major, minor, patchN] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let v = version.trim()
  while (existing.has(v)) {
    patchN += 1
    if (patchN > 999) { patchN = 0; minor += 1 }
    v = `${major}.${minor}.${patchN}`
  }
  return v
}

/** 语义化提交判定: feat/fix/refactor/perf, 含 scope 与 ! 变体 (导出供测试) */
export function isSemanticCommit(first: string): boolean {
  return /^(feat|fix|refactor|perf)(\([^)]*\))?[!:]/.test(first)
}

/** git 提交 → releases 表同步 (游标: 最新 Release notes 末行 git-cursor) */
export async function syncReleasesFromGit(): Promise<number> {
  const commits = await gitLogSince()
  if (!commits.length) return 0

  // 游标: 最新一条 Release 的 notes 末行 git-cursor: <hash>
  const latest = await prisma.release.findFirst({ orderBy: { createdAt: 'desc' } })
  const cursorMatch = latest ? /git-cursor:\s*([0-9a-f]+)/.exec(latest.notes) : null
  const cursor = cursorMatch ? cursorMatch[1] : null

  // 截取游标之前的新提交 (遇游标 hash 即停)
  let fresh = commits
  if (cursor) {
    const idx = commits.findIndex((c) => c.hash === cursor)
    if (idx >= 0) fresh = commits.slice(0, idx)
  } else {
    fresh = commits.slice(0, 50)
  }
  if (!fresh.length) return 0

  // 版本号: package.json version 冲突则 patch+1 递增
  const pkg = JSON.parse(await fs.promises.readFile(PKG_PATH, 'utf-8')) as { version?: string }
  const rows = await prisma.release.findMany({ select: { version: true } })
  const version = nextVersion(String(pkg.version || '0.0.0'), new Set(rows.map((r) => r.version)))

  const head = fresh[0]
  const tail = fresh[fresh.length - 1]
  const notes = fresh.map((c) => `- ${c.hash} ${c.first}`).join('\n') + `\ngit-cursor: ${commits[0].hash}`
  await prisma.release.create({
    data: {
      version,
      title: `v${version} 自动发版（${head.date.slice(0, 10)} ~ ${tail.date.slice(0, 10)}）`,
      notes,
      source: 'git'
    }
  })
  return 1
}

/** git 提交 → pitfalls 开发记录同步 (仅语义化提交, content 首行 commit: hash 去重) */
export async function syncDevlogFromGit(): Promise<number> {
  const commits = await gitLogSince()
  if (!commits.length) return 0

  // 收集 pitfalls 已有 hash 去重
  const rows = await prisma.pitfall.findMany({ select: { content: true } })
  const seen = new Set<string>()
  for (const r of rows) {
    const m = /commit:\s*([0-9a-f]+)/.exec(r.content)
    if (m) seen.add(m[1])
  }

  let n = 0
  for (const c of commits) {
    if (seen.has(c.hash) || !isSemanticCommit(c.first)) continue
    // 语义区分: git 同步的都是已完成工作 — fix 是踩过并填掉的坑 (已解决, medium),
    // feat/refactor/perf 是正常工作 (已解决, low)。「未解决」保留给手动记录/线上事故
    const isFix = /^fix(\([^)]*\))?[!:]/.test(c.first)
    await prisma.pitfall.create({
      data: {
        title: c.first.slice(0, 120),
        content: `commit: ${c.hash}\nauthor: ${c.author}\ndate: ${c.date}\n\n${c.full.trim()}`,
        severity: isFix ? 'medium' : 'low',
        resolved: true,
        source: 'git'
      }
    })
    seen.add(c.hash)
    n += 1
  }
  return n
}

// ===== 错误日志缓冲 + 事故自动记录 (onError → incidents) =====

interface ErrBuf { msg: string; count: number; firstAt: Date; lastAt: Date; stack: string; incidentId: string | null }
const errBuffer = new Map<string, ErrBuf>()
const ERR_WINDOW = 3600_000
const ERR_BUF_MAX = 200

/** 错误消息归一化 key: 去前后空白 + 截断 120 字 (导出供测试) */
export function errKeyOf(msg: string): string {
  return msg.trim().slice(0, 120)
}

/** 创建事故记录 (内部, fire-and-forget 调用) */
function createIncidentBuf(buf: ErrBuf): void {
  const content = `msg: ${buf.msg}\nfirst: ${buf.firstAt.toISOString()}\nstack:\n${buf.stack.slice(0, 800)}\ncount: ${buf.count}`
  const p = prisma.incident
    .create({
      data: {
        title: `[\u81ea动] ${buf.msg.slice(0, 80)}`,
        content,
        severity: 'high',
        status: 'open',
        source: 'log'
      }
    })
    .then((row) => {
      buf.incidentId = row.id
      buf.count = 0
    })
    .catch(() => {})
  void p
}

/** 后台记录服务器错误: 按消息聚合计数, 首次自动建 Incident, 窗口内重复只加计数 */
export function recordServerError(msg: string, stack = ''): void {
  const now = new Date()
  const key = errKeyOf(msg)
  const buf = errBuffer.get(key)
  if (buf && now.getTime() - buf.firstAt.getTime() < ERR_WINDOW) {
    buf.count += 1
    buf.lastAt = now
    // 每 5 次刷新一次事故内容 (fire-and-forget)
    if (buf.incidentId && buf.count % 5 === 0) {
      const content = `msg: ${buf.msg}\nfirst: ${buf.firstAt.toISOString()}\nstack:\n${buf.stack.slice(0, 800)}\ncount: ${buf.count}`
      void prisma.incident.update({ where: { id: buf.incidentId }, data: { content } }).catch(() => {})
    }
    return
  }
  // 环形控制: 超过 200 个 key 时删除最早的 (按 firstAt)
  if (!buf && errBuffer.size >= ERR_BUF_MAX) {
    let oldestKey = ''
    let oldestAt = Infinity
    for (const [k, v] of errBuffer) {
      if (v.firstAt.getTime() < oldestAt) {
        oldestAt = v.firstAt.getTime()
        oldestKey = k
      }
    }
    if (oldestKey) errBuffer.delete(oldestKey)
  }
  const fresh: ErrBuf = { msg, count: 1, firstAt: now, lastAt: now, stack, incidentId: null }
  errBuffer.set(key, fresh)
  createIncidentBuf(fresh)
}

/** 手动同步: 未建 incident 的缓冲立即建, 已建的刷新计数; 返回处理条数 */
export async function takePendingErrors(): Promise<number> {
  let n = 0
  for (const buf of errBuffer.values()) {
    if (buf.incidentId && buf.count > 0) {
      const content = `msg: ${buf.msg}\nfirst: ${buf.firstAt.toISOString()}\nstack:\n${buf.stack.slice(0, 800)}\ncount: ${buf.count}`
      await prisma.incident.update({ where: { id: buf.incidentId }, data: { content } }).catch(() => {})
      n += 1
      buf.count = 0
    } else if (!buf.incidentId) {
      createIncidentBuf(buf)
      n += 1
    }
  }
  return n
}

/** onError 钩子: 捕获路由处理抛出的错误进入缓冲 (不改 app.ts logger 配置) */
export function registerServerErrorCapture(app: FastifyInstance): void {
  app.addHook('onError', async (_req, _reply, err) => {
    recordServerError(err.message, err.stack || '')
  })
}

/** 启动时自动同步版本记录: 主项目 package.json version 变化时自动写入 Release (source=auto) */
async function autoSyncRelease(app: FastifyInstance): Promise<void> {
  try {
    const pkg = JSON.parse(await fs.promises.readFile(pkgVersionPath, 'utf-8')) as { version?: string }
    const version = (pkg.version || '').trim()
    if (!version) return
    const existing = await prisma.release.findUnique({ where: { version } })
    if (existing) return
    await prisma.release.create({
      data: { version, title: `v${version} 发布`, notes: '自动记录：检测到新版本部署', source: 'auto' }
    })
    app.log.info(`release auto-recorded: v${version}`)
  } catch (err) {
    app.log.warn(`autoSyncRelease failed: ${err}`)
  }
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
      },
      sourceHealth: getSourceHealthSnapshot()
    }
  })

  // 源优先级配置
  app.post('/api/admin/panel/source-priority', { preHandler: requirePanel }, async (req, reply) => {
    const { priority } = (req.body || {}) as { priority?: SourceId[] }
    if (!Array.isArray(priority) || priority.length !== SOURCE_PRIORITY.length) {
      return reply.code(400).send({ error: 'priority 需为全部源的全排列' })
    }
    setSourcePriority(priority)
    try {
      await savePriorityToDb(priority as SourceId[])
    } catch (e) {
      req.log.warn({ err: e }, 'save source priority to db failed')
    }
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

  // ============ 记录模块: 版本发布 / 开发坑 / 线上事故 ============

  // ---- 版本更新记录 ----
  app.get('/api/admin/panel/releases', { preHandler: requirePanel }, async () => {
    const rows = await prisma.release.findMany({ orderBy: { createdAt: 'desc' } })
    return rows
  })

  app.post('/api/admin/panel/releases', { preHandler: requirePanel }, async (req, reply) => {
    const { version, title, notes } = (req.body || {}) as { version?: string; title?: string; notes?: string }
    if (!version || !version.trim()) return reply.code(400).send({ error: 'version 必填' })
    const row = await prisma.release.upsert({
      where: { version: version.trim() },
      update: { title: title || version.trim(), notes: notes || '' },
      create: { version: version.trim(), title: title || version.trim(), notes: notes || '', source: 'manual' }
    })
    await audit(panelEmail(req), 'create_release', row.id, { version: row.version })
    return row
  })

  app.delete('/api/admin/panel/releases/:id', { preHandler: requirePanel }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await prisma.release.delete({ where: { id } }).catch(() => null)
    await audit(panelEmail(req), 'delete_release', id)
    return { ok: true }
  })

  // ---- 开发坑 / 严重 Bug ----
  app.get('/api/admin/panel/pitfalls', { preHandler: requirePanel }, async () => {
    const rows = await prisma.pitfall.findMany({ orderBy: { createdAt: 'desc' } })
    return rows
  })

  app.post('/api/admin/panel/pitfalls', { preHandler: requirePanel }, async (req, reply) => {
    const { title, content, severity, resolved } = (req.body || {}) as {
      title?: string; content?: string; severity?: string; resolved?: boolean
    }
    if (!title || !title.trim()) return reply.code(400).send({ error: 'title 必填' })
    const row = await prisma.pitfall.create({
      data: {
        title: title.trim(),
        content: content || '',
        severity: severity || 'medium',
        resolved: resolved ?? false,
        source: 'manual'
      }
    })
    await audit(panelEmail(req), 'create_pitfall', row.id, { title: row.title })
    return row
  })

  app.patch('/api/admin/panel/pitfalls/:id', { preHandler: requirePanel }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { title, content, severity, resolved } = (req.body || {}) as {
      title?: string; content?: string; severity?: string; resolved?: boolean
    }
    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title
    if (content !== undefined) data.content = content
    if (severity !== undefined) data.severity = severity
    if (resolved !== undefined) data.resolved = resolved
    const row = await prisma.pitfall.update({ where: { id }, data }).catch(() => null)
    if (!row) return reply.code(404).send({ error: '记录不存在' })
    await audit(panelEmail(req), 'update_pitfall', id)
    return row
  })

  app.delete('/api/admin/panel/pitfalls/:id', { preHandler: requirePanel }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await prisma.pitfall.delete({ where: { id } }).catch(() => null)
    await audit(panelEmail(req), 'delete_pitfall', id)
    return { ok: true }
  })

  // ---- 线上事故 ----
  app.get('/api/admin/panel/incidents', { preHandler: requirePanel }, async () => {
    const rows = await prisma.incident.findMany({ orderBy: { startedAt: 'desc' } })
    return rows
  })

  app.post('/api/admin/panel/incidents', { preHandler: requirePanel }, async (req, reply) => {
    const { title, content, severity } = (req.body || {}) as {
      title?: string; content?: string; severity?: string
    }
    if (!title || !title.trim()) return reply.code(400).send({ error: 'title 必填' })
    const row = await prisma.incident.create({
      data: { title: title.trim(), content: content || '', severity: severity || 'medium', status: 'open' }
    })
    await audit(panelEmail(req), 'create_incident', row.id, { title: row.title })
    return row
  })

  app.patch('/api/admin/panel/incidents/:id', { preHandler: requirePanel }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { title, content, severity, status } = (req.body || {}) as {
      title?: string; content?: string; severity?: string; status?: string
    }
    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title
    if (content !== undefined) data.content = content
    if (severity !== undefined) data.severity = severity
    if (status !== undefined) {
      data.status = status
      data.resolvedAt = status === 'resolved' ? new Date() : null
    }
    const row = await prisma.incident.update({ where: { id }, data }).catch(() => null)
    if (!row) return reply.code(404).send({ error: '记录不存在' })
    await audit(panelEmail(req), 'update_incident', id, { status })
    return row
  })

  app.delete('/api/admin/panel/incidents/:id', { preHandler: requirePanel }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await prisma.incident.delete({ where: { id } }).catch(() => null)
    await audit(panelEmail(req), 'delete_incident', id)
    return { ok: true }
  })
  // ---- 记录同步 (git → releases/pitfalls, 错误缓冲 → incidents) ----
  app.post('/api/admin/panel/releases/sync', { preHandler: requirePanel }, async (req) => {
    const n = await syncReleasesFromGit()
    await audit(panelEmail(req), 'sync_releases', undefined, { synced: n })
    return { synced: n }
  })

  app.post('/api/admin/panel/pitfalls/sync', { preHandler: requirePanel }, async (req) => {
    const n = await syncDevlogFromGit()
    await audit(panelEmail(req), 'sync_pitfalls', undefined, { synced: n })
    return { synced: n }
  })

  app.post('/api/admin/panel/incidents/sync', { preHandler: requirePanel }, async (req) => {
    const n = await takePendingErrors()
    await audit(panelEmail(req), 'sync_incidents', undefined, { synced: n })
    return { synced: n }
  })

  registerServerErrorCapture(app)
  await autoSyncRelease(app)

  // git 提交 → 版本/开发记录自动同步 (启动时, 异步不阻塞)
  void syncReleasesFromGit().then((n) => { if (n) app.log.info(`release git-sync: ${n}`) }).catch(() => {})
  void syncDevlogFromGit().then((n) => { if (n) app.log.info(`devlog git-sync: ${n}`) }).catch(() => {})
}


