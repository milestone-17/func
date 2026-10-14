/**
 * 回测产物月度刷新: 每月重跑 15 年回测, 刷新 public/backtest-data.json。
 * 防重入; 单次执行异常只记日志, 不影响主服务。
 */
import cron from 'node-cron'
import { runBacktestRefresh } from '../lib/backtest-run'

let running = false

export async function refreshBacktestNow(): Promise<void> {
  if (running) {
    console.warn('[backtest] 上一次刷新尚未完成, 跳过本轮')
    return
  }
  running = true
  try {
    await runBacktestRefresh()
    console.log('[backtest] 产物刷新完成')
  } catch (e) {
    console.error('[backtest] 刷新失败:', (e as Error).message)
  } finally {
    running = false
  }
}

export function startBacktestCron(): void {
  // UTC 20:43 每月 1 日 ≈ 北京时间每月 2 日 04:43 (凌晨低峰, 避开 market 任务 UTC 22:17)
  cron.schedule('43 20 1 * *', () => {
    void refreshBacktestNow()
  })
  console.log('[backtest] cron started (monthly, day 1 20:43 UTC)')
}
