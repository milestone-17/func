import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../plugins/auth'

interface ResDef {
  model: string
  filters?: string[]
  /** 纯真实列模型 (无 data Json 列): 读写直接映射列, 返回时拼接 */
  flat?: boolean
}

function toDateVal(v: unknown): Date | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? new Date(n) : null
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

function baseData(resource: string, userId: string, id: string, body: Record<string, unknown>) {
  const now = new Date()
  const createdAt = toDateVal(body.createdAt) || now
  return {
    id,
    userId,
    ...filterCols(resource, body),
    createdAt,
    updatedAt: toDateVal(body.updatedAt) || createdAt,
    deletedAt: toDateVal(body.deletedAt),
    data: body as object
  }
}

export const RESOURCES: Record<string, ResDef> = {
  transactions: { model: 'transaction', filters: ['date', 'type', 'categoryId'] },
  categories: { model: 'category' },
  budgets: { model: 'budget', filters: ['month'] },
  holdings: { model: 'holding', filters: ['symbol', 'type'] },
  holdingTxns: { model: 'holdingTxn', filters: ['holdingId', 'date'] },
  permanentTargets: { model: 'permanentTarget' },
  dcaConfigs: { model: 'dcaConfig' },
  dcaExecutions: { model: 'dcaExecution', filters: ['configId', 'month'] },
  dailyDcaConfigs: { model: 'dailyDcaConfig' },
  settings: { model: 'appSetting' },
  meta: { model: 'metaEntry' },
  valuationSnapshots: { model: 'valuationSnapshot' },
  dcaFunds: { model: 'dcaFund', filters: ['code'], flat: true }
}

/** 行 → API 对象: 常规模型返回 data 列; flat 模型拼真实列 + 兜底字段 */
function rowToItem(def: ResDef, r: Record<string, unknown>): unknown {
  if (!def.flat) return r.data
  return { ...(r as Record<string, unknown>) }
}

export async function crudRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/:resource', { preHandler: requireAuth }, async (req, reply) => {
    const { resource } = req.params as { resource: string }
    const def = RESOURCES[resource]
    if (!def) return reply.code(404).send({ error: '未知资源' })
    const q = (req.query || {}) as Record<string, string>
    const where: Record<string, unknown> = { userId: req.userId }
    for (const f of def.filters || []) {
      if (q[f] !== undefined) where[f] = q[f]
    }
    const rows = await (prisma[def.model as keyof typeof prisma] as any).findMany({ where, orderBy: { createdAt: 'asc' } })
    return { items: rows.map((r: any) => rowToItem(def, r)) }
  })

  app.post('/api/:resource', { preHandler: requireAuth }, async (req, reply) => {
    const { resource } = req.params as { resource: string }
    const def = RESOURCES[resource]
    if (!def) return reply.code(404).send({ error: '未知资源' })
    const body = (req.body || {}) as Record<string, unknown>
    if (!body.id || typeof body.id !== 'string') return reply.code(400).send({ error: '缺少 id' })
    if (def.flat) {
      const now = new Date()
      const model = prisma[def.model as keyof typeof prisma] as any
      const created = await model.upsert({
        where: { id: body.id },
        create: {
          id: body.id,
          userId: req.userId!,
          code: String(body.code || ''),
          name: String(body.name || ''),
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        },
        update: { code: String(body.code || ''), name: String(body.name || ''), deletedAt: null, updatedAt: new Date() }
      })
      return { item: created }
    }
    const row = baseData(resource, req.userId!, body.id, body)
    const model = prisma[def.model as keyof typeof prisma] as any
    const created = await model.upsert({
      where: { id: body.id },
      create: row,
      update: { ...row, id: undefined }
    })
    return { item: created.data }
  })

  app.get('/api/:resource/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { resource, id } = req.params as { resource: string; id: string }
    const def = RESOURCES[resource]
    if (!def) return reply.code(404).send({ error: '未知资源' })
    const row = await (prisma[def.model as keyof typeof prisma] as any).findFirst({ where: { id, userId: req.userId } })
    if (!row) return reply.code(404).send({ error: '不存在' })
    return { item: rowToItem(def, row) }
  })

  app.put('/api/:resource/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { resource, id } = req.params as { resource: string; id: string }
    const def = RESOURCES[resource]
    if (!def) return reply.code(404).send({ error: '未知资源' })
    const body = (req.body || {}) as Record<string, unknown>
    const model = prisma[def.model as keyof typeof prisma] as any
    const existing = await model.findFirst({ where: { id, userId: req.userId } })
    if (!existing) return reply.code(404).send({ error: '不存在' })
    if (def.flat) {
      const updated = await model.update({
        where: { id: existing.id },
        data: { code: String(body.code || existing.code), name: String(body.name || existing.name), updatedAt: new Date() }
      })
      return { item: updated }
    }
    const row = baseData(resource, req.userId!, id, body)
    const updated = await model.update({ where: { id: existing.id }, data: row })
    return { item: updated.data }
  })

  app.delete('/api/:resource/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { resource, id } = req.params as { resource: string; id: string }
    const def = RESOURCES[resource]
    if (!def) return reply.code(404).send({ error: '未知资源' })
    const model = prisma[def.model as keyof typeof prisma] as any
    const existing = await model.findFirst({ where: { id, userId: req.userId } })
    if (!existing) return reply.code(404).send({ error: '不存在' })
    if (existing.deletedAt) return { ok: true }
    if (def.flat) {
      await model.update({ where: { id: existing.id }, data: { deletedAt: new Date(), updatedAt: new Date() } })
      return { ok: true }
    }
    await model.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        data: { ...(existing.data as object), deletedAt: Date.now(), updatedAt: Date.now() }
      }
    })
    return { ok: true }
  })
}
