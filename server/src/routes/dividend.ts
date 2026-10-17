/**
 * 红利分数 API 路由: GET /api/dividend/score
 * 读取 IndexData 中 dividend-score::latest 单行快照; 无数据时现场触发一次刷新 (首次访问兜底)
 * 错误契约: 数据源故障统一 503 + 友好文案 (前端展示引导"稍后自动恢复", 不弹红色错误)
 */
import { FastifyInstance } from 'fastify'
import { requireAuth } from '../plugins/auth'
import { loadSnapshot } from '../lib/dividend-data'
import { refreshDividendScoreNow } from '../cron/dividend'

export async function dividendRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dividend/score', { preHandler: requireAuth }, async (_req, reply) => {
    let data = await loadSnapshot()
    let cached = true
    if (!data) {
      // 首次访问兜底: 现场刷新一次 (并发请求间由 cron 模块防重入保护)
      const snap = await refreshDividendScoreNow()
      if (!snap) {
        return reply.code(503).send({
          code: 503,
          error: '行情数据源暂时不可用, 正在自动重试; 通常数分钟内恢复, 请稍后刷新'
        })
      }
      data = await loadSnapshot()
      cached = false
    }
    if (!data) {
      return reply.code(503).send({
        code: 503,
        error: '行情数据源暂时不可用, 正在自动重试; 通常数分钟内恢复, 请稍后刷新'
      })
    }
    return { code: 200, message: 'success', data: { ...(data as Record<string, unknown>), cached } }
  })
}
