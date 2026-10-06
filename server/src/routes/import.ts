import { FastifyInstance } from 'fastify'
import { requireAuth } from '../plugins/auth'
import { prisma } from '../lib/prisma'

const STORE_TO_MODEL: Record<string, string> = {
  transactions: 'transaction',
  categories: 'category',
  budgets: 'budget',
  holdings: 'holding',
  holdingTxns: 'holdingTxn',
  permanentTargets: 'permanentTarget',
  dcaConfigs: 'dcaConfig',
  dcaExecutions: 'dcaExecution',
  dailyDcaConfigs: 'dailyDcaConfig',
  settings: 'appSetting',
  meta: 'metaEntry',
  valuationSnapshots: 'valuationSnapshot'
}

function filterCols(resource: string, b: Record<string, unknown>): Record<string, unknown> {
  switch (resource) {
    case 'transactions': return { date: String(b.date || ''), type: String(b.type || ''), categoryId: b.categoryId ? String(b.categoryId) : null }
    case 'holdings': return { symbol: String(b.symbol || ''), type: String(b.type || '') }
    case 'holdingTxns': return { holdingId: String(b.holdingId || ''), date: String(b.date || '') }
    case 'budgets': return { month: String(b.month || '') }
    case 'dcaExecutions': return { configId: String(b.configId || ''), month: String(b.month || ''), weekIndex: Number(b.weekIndex || 0) }
    case 'meta': return { key: String(b.key || '') }
    case 'valuationSnapshots': return { day: String(b.id || '') }
    default: return {}
  }
}

function rowFor(resource: string, userId: string, b: Record<string, unknown>): Record<string, unknown> {
  const createdAt = b.createdAt ? new Date(Number(b.createdAt)) : new Date()
  return {
    id: String(b.id),
    userId,
    ...filterCols(resource, b),
    createdAt,
    updatedAt: b.updatedAt ? new Date(Number(b.updatedAt)) : createdAt,
    deletedAt: b.deletedAt ? new Date(Number(b.deletedAt)) : null,
    data: b as object
  }
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/import', { preHandler: requireAuth }, async (req, reply) => {
    const bundle = (req.body || {}) as { schemaVersion?: number; exportedAt?: string; data?: Record<string, unknown[]> }
    if (!bundle || bundle.schemaVersion !== 1 || !bundle.data) {
      return reply.code(400).send({ error: '备份格式不合法' })
    }
    const userId = req.userId!
    const summary: Record<string, number> = {}
    await prisma.$transaction(async (tx) => {
      for (const [store, modelName] of Object.entries(STORE_TO_MODEL)) {
        const rows = (bundle.data![store] || []) as Record<string, unknown>[]
        if (!rows.length) continue
        const model = tx[modelName as keyof typeof tx] as any
        for (const b of rows) {
          if (!b || typeof b !== 'object' || !b.id) continue
          const row = rowFor(store, userId, b)
          // 属主校验: id 属于其他用户 → 跳过该行 (防导入劫持他人数据)
          const model2 = tx[modelName as keyof typeof tx] as any
          const existing = await model2.findUnique({ where: { id: row.id as string }, select: { userId: true } })
          if (existing && existing.userId !== userId) continue
          await model2.upsert({ where: { id: row.id as string }, create: row, update: { ...row, id: undefined } })
        }
        summary[store] = rows.length
      }
      await prisma.user.update({ where: { id: userId }, data: { lastImportAt: new Date() } })
    })
    return { ok: true, summary }
  })
}
