import cron from 'node-cron'
import { prisma } from '../lib/prisma'
import { fetchWithFallback, SOURCE_PRIORITY, type SourceId } from '../lib/market-fetcher'
import { loadPriorityFromDb } from '../lib/source-config'

let retryTimer: NodeJS.Timeout | null = null
let currentPriority: SourceId[] = [...SOURCE_PRIORITY]

/** 管理后台调整源优先级时调用 */
export function setSourcePriority(priority: SourceId[]): void {
  const valid = priority.filter(p => SOURCE_PRIORITY.includes(p))
  if (valid.length === SOURCE_PRIORITY.length) currentPriority = valid
}

export function getSourcePriority(): SourceId[] {
  return [...currentPriority]
}

export async function syncMarketNow(): Promise<{ rows: number; source: SourceId | null }> {
  const result = await fetchWithFallback(currentPriority)
  if (!result) {
    console.warn('[market] 全部源失败, 保留旧数据')
    return { rows: 0, source: null }
  }
  for (const r of result.rows) {
    const data = r.data as Record<string, unknown>
    data.source = result.source
    await prisma.indexData.upsert({
      where: { id: `${r.symbol}::${r.date}` },
      create: { id: `${r.symbol}::${r.date}`, symbol: r.symbol, date: r.date, data: r.data as object },
      update: { data: r.data as object }
    })
  }
  console.log(`[market] 写入 ${result.rows.length} 行 (source=${result.source})`)
  return { rows: result.rows.length, source: result.source }
}

/** 失败后 30 分钟重试直至成功 (单次链, 不叠加) */
function scheduleRetry(): void {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    syncMarketNow()
      .then(r => { if (r.rows === 0) scheduleRetry() })
      .catch(e => {
        console.error('[market] 重试失败:', e.message)
        scheduleRetry()
      })
  }, 30 * 60 * 1000)
}

/** 启动时从数据库恢复持久化的源优先级 (失败不阻塞启动) */
export async function restorePriorityFromDb(): Promise<void> {
  try {
    const saved = await loadPriorityFromDb()
    if (saved) {
      setSourcePriority(saved as SourceId[])
      console.log('[market] 优先级已从数据库恢复: ' + saved.join(','))
    }
  } catch (e) {
    console.warn('[market] 恢复源优先级失败: ' + ((e as Error).message || e))
  }
}

export function startMarketCron(): void {
  void restorePriorityFromDb()
  // UTC 22:17 周一~周五 ≈ 北京时间交易日次日 06:17 (美股收盘后)
  cron.schedule('17 22 * * 1-5', () => {
    syncMarketNow()
      .then(r => { if (r.rows === 0) scheduleRetry() })
      .catch(e => {
        console.error('[market] cron 执行失败:', e.message)
        scheduleRetry()
      })
  })
  // 启动时若库中无数据则立即抓一次, 失败进入重试链
  prisma.indexData.count().then(n => {
    if (n === 0) {
      syncMarketNow()
        .then(r => { if (r.rows === 0) scheduleRetry() })
        .catch(e => {
          console.error('[market] 初始抓取失败:', e.message)
          scheduleRetry()
        })
    }
  })
}
