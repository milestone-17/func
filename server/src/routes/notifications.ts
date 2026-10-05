/**
 * 通知设置接口:
 *   GET  /api/notifications/config  查询 (无记录返回默认)
 *   PUT  /api/notifications/config  更新 (校验参数)
 *   POST /api/notifications/test    向通知邮箱发测试邮件
 *   GET  /api/notifications/logs    本人发送流水 (倒序)
 */
import { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../plugins/auth'
import { sendTestMail } from '../lib/mailer'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export interface NotifyData {
  enabled: boolean
  notifyEmail: string
  frequency: 'daily' | 'weekly'
  dayOfWeek: number // 0=周日 ... 6=周六
  time: string      // 'HH:mm' Asia/Shanghai
}

export function defaultNotifyData(accountEmail: string): NotifyData {
  return {
    enabled: false,
    notifyEmail: accountEmail,
    frequency: 'daily',
    dayOfWeek: 1,
    time: '08:30'
  }
}

/** 校验并规范化 PUT body; 非法时返回错误消息 */
export function validateNotifyPatch(body: unknown): { ok: true; patch: Partial<NotifyData> } | { ok: false; error: string } {
  const b = (body || {}) as Record<string, unknown>
  const patch: Partial<NotifyData> = {}
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return { ok: false, error: 'enabled 必须为布尔值' }
    patch.enabled = b.enabled
  }
  if (b.notifyEmail !== undefined) {
    if (typeof b.notifyEmail !== 'string' || !EMAIL_RE.test(b.notifyEmail.trim())) return { ok: false, error: '邮箱不合法' }
    patch.notifyEmail = b.notifyEmail.trim().toLowerCase()
  }
  if (b.frequency !== undefined) {
    if (b.frequency !== 'daily' && b.frequency !== 'weekly') return { ok: false, error: 'frequency 仅支持 daily/weekly' }
    patch.frequency = b.frequency
  }
  if (b.dayOfWeek !== undefined) {
    const n = Number(b.dayOfWeek)
    if (!Number.isInteger(n) || n < 0 || n > 6) return { ok: false, error: 'dayOfWeek 必须为 0-6 的整数' }
    patch.dayOfWeek = n
  }
  if (b.time !== undefined) {
    if (typeof b.time !== 'string' || !TIME_RE.test(b.time)) return { ok: false, error: 'time 必须为 HH:mm (00:00-23:59)' }
    patch.time = b.time
  }
  return { ok: true, patch }
}

function myId(req: FastifyRequest): string {
  const id = req.userId
  if (!id) throw new Error('unauthorized')
  return id
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  /** 载入本人配置 (无则落库默认) */
  async function loadConfig(userId: string, accountEmail: string): Promise<NotifyData> {
    const row = await prisma.notificationConfig.findUnique({ where: { userId } })
    if (!row) {
      const def = defaultNotifyData(accountEmail)
      await prisma.notificationConfig.create({ data: { userId, data: { ...def } } })
      return def
    }
    return { ...defaultNotifyData(accountEmail), ...(row.data as Partial<NotifyData>) }
  }

  app.get('/api/notifications/config', { preHandler: requireAuth }, async (req) => {
    const userId = myId(req)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    const data = await loadConfig(userId, user?.email || '')
    return { config: data }
  })

  app.put('/api/notifications/config', { preHandler: requireAuth }, async (req, reply) => {
    const v = validateNotifyPatch(req.body)
    if (!v.ok) return reply.code(400).send({ error: v.error })
    const userId = myId(req)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    const cur = await loadConfig(userId, user?.email || '')
    const next = { ...cur, ...v.patch }
    await prisma.notificationConfig.upsert({
      where: { userId },
      create: { userId, data: { ...next } },
      update: { data: { ...next } }
    })
    return { config: next }
  })

  app.post('/api/notifications/test', { preHandler: requireAuth }, async (req, reply) => {
    const userId = myId(req)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    const cfg = await loadConfig(userId, user?.email || '')
    try {
      await sendTestMail(cfg.notifyEmail)
      return { ok: true }
    } catch (e) {
      return reply.code(502).send({ error: `测试邮件发送失败: ${(e as Error).message}` })
    }
  })

  app.get('/api/notifications/logs', { preHandler: requireAuth }, async (req) => {
    const userId = myId(req)
    const { limit } = (req.query || {}) as { limit?: string }
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200)
    const logs = await prisma.notificationLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: n
    })
    return { logs }
  })
}
