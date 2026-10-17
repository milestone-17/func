/**
 * 回测 API 路由: GET /api/backtest
 * 编排 backtest-data / backtest-strategy-a / backtest-strategy-b / backtest-metrics 四层引擎,
 * 附带同参内存缓存 (10 分钟, 按用户隔离) 与新标的东财首拉限频 (10 次/小时/用户)
 */
import { FastifyInstance } from 'fastify'
import { requireAuth } from '../plugins/auth'
import {
  resolveTarget, getDailyBars, getFxUsdcnh, fillForwardFx, PRESET_TARGETS
} from '../lib/backtest-data'
import { runStrategyA } from '../lib/backtest-strategy-a'
import { runStrategyB } from '../lib/backtest-strategy-b'
import {
  computeCoreMetrics, metricsForWindow, sliceMonthly,
  type CoreMetrics, type WindowKey
} from '../lib/backtest-metrics'

const CACHE_TTL_MS = 10 * 60_000
const FETCH_LIMIT = 10
const FETCH_WINDOW_MS = 3600_000
// 各窗口所需的最少日K条数 (约 5/10/15 年 A股交易日)
const MIN_BARS: Record<WindowKey, number> = { y5: 1300, y10: 2600, full: 3600 }
// 与 backtest-metrics 的 WINDOW_POINTS 一致 (该常量未导出)
const WINDOW_POINTS: Record<WindowKey, number | null> = { y5: 60, y10: 120, full: null }

interface BacktestPayload {
  target: string
  name: string
  fee: number
  amountBase: number
  window: WindowKey
  strategy: 'a' | 'b'
  metrics: CoreMetrics
}

const resultCache = new Map<string, { expiresAt: number; payload: BacktestPayload }>()
const fetchHistory = new Map<string, number[]>() // userId -> 东财实际拉取发生的时间戳

function cacheGet(key: string): BacktestPayload | null {
  const hit = resultCache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    resultCache.delete(key)
    return null
  }
  return hit.payload
}

function cacheSet(key: string, payload: BacktestPayload): void {
  resultCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload })
  setTimeout(() => {
    const cur = resultCache.get(key)
    if (cur && cur.expiresAt <= Date.now()) resultCache.delete(key)
  }, CACHE_TTL_MS).unref()
}

/** 最近一小时内的拉取次数 (顺带清理过期时间戳) */
function fetchCountInHour(userId: string): number {
  const cutoff = Date.now() - FETCH_WINDOW_MS
  const list = (fetchHistory.get(userId) ?? []).filter(ts => ts > cutoff)
  fetchHistory.set(userId, list)
  return list.length
}

export async function backtestRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/backtest', { preHandler: requireAuth }, async (req, reply) => {
    const q = (req.query || {}) as {
      target?: string; fee?: string; amountBase?: string; window?: string; strategy?: string
    }

    // ---------- 参数校验 ----------
    const target = (q.target ?? '').trim()
    if (!target) return reply.code(400).send({ code: 400, message: 'target 参数不能为空' })
    let fee = 0.0005
    if (q.fee !== undefined && q.fee !== '') {
      fee = Number(q.fee)
      if (!Number.isFinite(fee) || fee < 0 || fee > 0.03) {
        return reply.code(400).send({ code: 400, message: 'fee 费率需在 0~0.03 (即 0~3%) 之间' })
      }
    }
    const window = (q.window || 'full') as WindowKey
    if (!['y5', 'y10', 'full'].includes(window)) {
      return reply.code(400).send({ code: 400, message: 'window 仅支持 y5 | y10 | full' })
    }
    const strategy = (q.strategy || 'a') as 'a' | 'b'
    if (!['a', 'b'].includes(strategy)) {
      return reply.code(400).send({ code: 400, message: 'strategy 仅支持 a | b' })
    }
    let amountBase = strategy === 'a' ? 1000 : 100000
    if (q.amountBase !== undefined && q.amountBase !== '') {
      amountBase = Number(q.amountBase)
      if (!Number.isFinite(amountBase) || amountBase <= 0) {
        return reply.code(400).send({ code: 400, message: 'amountBase 需为正数' })
      }
    }

    // 目标格式非法属客户端错误
    let resolved
    try {
      resolved = resolveTarget(target)
    } catch (e) {
      return reply.code(400).send({ code: 400, message: (e as Error).message })
    }

    const userId = req.userId!
    const cacheKey = `${userId}:${resolved.secid}|${fee}|${amountBase}|${window}|${strategy}`

    // ---------- 同参缓存 (10 分钟) ----------
    const cached = cacheGet(cacheKey)
    if (cached) return { code: 200, message: 'success', data: { ...cached, cached: true } }

    // ---------- 新标的首拉限频预检: 非预置标的且近一小时已拉取 >=10 次 -> 429 ----------
    const isPreset = PRESET_TARGETS.some(t => t.secid === resolved.secid)
    if (!isPreset && fetchCountInHour(userId) >= FETCH_LIMIT) {
      return reply.code(429).send({ code: 429, message: '回测请求过于频繁，请稍后重试' })
    }

    // ---------- 引擎编排 ----------
    try {
      const { bars, source } = await getDailyBars(resolved, MIN_BARS[window])
      if (source === 'fetch') {
        const list = fetchHistory.get(userId) ?? []
        list.push(Date.now())
        fetchHistory.set(userId, list)
      }
      const fxByDate = resolved.currency === 'USD'
        ? fillForwardFx(await getFxUsdcnh(), bars.map(b => b.date))
        : new Map<string, number>()

      let metrics: CoreMetrics
      if (strategy === 'a') {
        const result = runStrategyA({
          bars,
          currency: resolved.currency,
          fxByDate,
          params: { monthlyAmount: amountBase, feeRate: fee, riskFreeAnnual: 0.02 }
        })
        const nPts = WINDOW_POINTS[window]
        let investedAtStart = 0
        let wealthAtStart = 0
        if (nPts !== null && result.monthly.length >= nPts) {
          const idx = result.monthly.length - nPts - 1
          investedAtStart = idx >= 0 ? result.monthly[idx].invested : 0
          wealthAtStart = idx >= 0 ? result.monthly[idx].wealth : 0
        }
        metrics = metricsForWindow(result.monthly, investedAtStart, window, wealthAtStart)
      } else {
        const result = runStrategyB({
          bars,
          currency: resolved.currency,
          fxByDate,
          params: {
            initialCash: amountBase,
            monthlyBuyStrong: 2000,
            monthlyBuy: 1000,
            sellTrimPct: 0.25,
            feeRate: fee,
            riskFreeAnnual: 0.02
          }
        })
        // 窗口指标与策略 A 统一为“区间独立”口径:
        // invested 与 wealth 同步平移到窗口期初, 不再拿全区间终值当分子
        const nPtsB = WINDOW_POINTS[window]
        let investedAtStartB = 0
        let wealthAtStartB = 0
        if (nPtsB !== null && result.monthly.length >= nPtsB) {
          const idx = result.monthly.length - nPtsB - 1
          investedAtStartB = idx >= 0 ? result.monthly[idx].invested : 0
          wealthAtStartB = idx >= 0 ? result.monthly[idx].wealth : 0
        }
        metrics = metricsForWindow(
          result.monthly.map(p => ({ date: p.date, invested: p.invested, wealth: p.wealth })),
          investedAtStartB,
          window,
          wealthAtStartB
        )
      }

      const payload: BacktestPayload = {
        target: resolved.secid, name: resolved.name, fee, amountBase, window, strategy, metrics
      }
      cacheSet(cacheKey, payload)
      return { code: 200, message: 'success', data: payload }
    } catch (e) {
      return reply.code(500).send({ code: 500, message: `回测失败: ${(e as Error).message}` })
    }
  })
}
