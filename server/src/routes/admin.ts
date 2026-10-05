import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../plugins/auth'
import { syncMarketNow } from '../cron/market'

/** admin 守卫: 非 admin 403 */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply)
  if (reply.sent) return
  const user = await prisma.user.findUnique({ where: { id: req.userId! } })
  if (!user || user.role !== 'admin') {
    await reply.code(403).send({ error: '需要管理员权限' })
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // 用户列表
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

  // 禁用/启用
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

  // 删除 (软删用户 + 全部业务数据)
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
      prisma.user.update({ where: { id }, data: { disabled: true, email: `deleted-${id.slice(0, 8)}@deleted.local`, passwordHash: null, githubId: null } })
    ])
    return { ok: true }
  })

  // 统计
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

  // 手动触发行情同步
  app.post('/api/admin/market/sync', { preHandler: requireAdmin }, async () => {
    const rows = await syncMarketNow()
    return { ok: rows > 0, rows }
  })
}
