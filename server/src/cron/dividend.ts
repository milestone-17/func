/**
 * 红利分数定时调度:
 * - cron A: UTC 22:43 每工作日 (≈北京时间次日 06:43, 避开 market 任务 22:17) 刷新快照
 * - cron B: 每分钟扫描当日快照, 到达用户配置通知时刻 (cfg.time, 默认 18:00) 即派发红利日报
 * - 邮件防重/失败重试用 NotificationLog.slot='dividend:{date}' 前缀 (同用户失败≥3 次跳过),
 *   不与定投通知共用的 lastSentSlot 字段冲突; 不修改 notification.ts/notify.ts
 */
import cron from 'node-cron'
import { prisma } from '../lib/prisma'
import { shanghaiNow, timeToMinutes } from '../lib/notification'
import { sendNotificationMail } from '../lib/mailer'
import { renderDividendMail } from '../lib/dividend-mail'
import { runDividendRefresh } from '../lib/dividend-run'
import { loadSnapshot } from '../lib/dividend-data'
import type { DividendSnapshot } from '../lib/dividend-engine'
import type { Env } from '../env'

let running = false
/** SMTP 未配置只告警一次 (cron B 每分钟跑, 避免刷日志) */
let smtpWarned = false

/** 当日邮件是否已处理 (成功 sent 视为已发; 失败 ≥3 次本轮跳过) */
async function isMailHandled(userId: string, slot: string): Promise<boolean> {
  const sent = await prisma.notificationLog.findFirst({
    where: { userId, slot, status: 'sent' },
    select: { id: true }
  })
  if (sent) return true
  const failed = await prisma.notificationLog.count({ where: { userId, slot, status: 'failed' } })
  return failed >= 3
}

/**
 * 派发当日红利日报: 读当日快照 (不触发刷新), 扫描启用通知配置的用户,
 * 时间门槛 now.time >= cfg.time (默认 '18:00'), 防重 slot='dividend:{date}'。
 */
export async function dispatchDividendMail(env?: Env): Promise<void> {
  try {
    if (env && (!env.smtpHost || !env.smtpUser || !env.smtpPass)) {
      if (!smtpWarned) {
        console.warn('[dividend] SMTP 未配置, 红利日报邮件不发送')
        smtpWarned = true
      }
      return
    }
    const nowSh = shanghaiNow()
    const slot = `dividend:${nowSh.date}`
    const snap = await loadSnapshot() as DividendSnapshot | null
    if (!snap || (snap as { date?: string }).date !== nowSh.date) return // 无当日快照不派发
    const configs = await prisma.notificationConfig.findMany()
    for (const c of configs) {
      try {
        const d = c.data as Partial<{ enabled: boolean; notifyEmail: string; time: string }>
        if (!d?.enabled || !d.notifyEmail) continue
        // 时间门槛: 到达用户配置的通知时刻才发 (未配置默认 18:00), 复用定投通知 time 字段语义
        if (timeToMinutes(nowSh.time) < timeToMinutes(d.time || '18:00')) continue
        if (await isMailHandled(c.userId, slot)) continue
        const mail = renderDividendMail(snap)
        try {
          await sendNotificationMail(d.notifyEmail, mail.subject, mail.html, mail.text)
          await prisma.notificationLog.create({ data: { userId: c.userId, slot, status: 'sent' } })
          console.log(`[dividend] 邮件已发送: ${d.notifyEmail} ${slot}`)
        } catch (e) {
          await prisma.notificationLog.create({ data: { userId: c.userId, slot, status: 'failed', error: (e as Error).message.slice(0, 500) } })
          console.error(`[dividend] 邮件发送失败 ${d.notifyEmail}:`, (e as Error).message)
        }
      } catch (e) {
        console.error(`[dividend] 用户 ${c.userId} 处理异常:`, (e as Error).message)
      }
    }
  } catch (e) {
    console.error('[dividend] 邮件派发异常:', (e as Error).message)
  }
}

/** 刷新快照并尝试派发 (已到达配置时刻的用户立即拿到; 其余由 cron B 在各自时刻派发) */
export async function refreshDividendScoreNow(env?: Env): Promise<DividendSnapshot | null> {
  if (running) {
    console.warn('[dividend] 上一次刷新尚未完成, 跳过本轮')
    return null
  }
  running = true
  try {
    const snapshot = await runDividendRefresh()
    await dispatchDividendMail(env)
    return snapshot
  } catch (e) {
    console.error('[dividend] 刷新失败:', (e as Error).message)
    return null
  } finally {
    running = false
  }
}

let started = false

export function startDividendCron(env?: Env): void {
  if (started) return
  started = true
  // cron A: UTC 22:43 每周一~五 ≈ 北京时间 06:43 (收盘数据已稳定, 避开 market 任务 UTC 22:17)
  cron.schedule('43 22 * * 1-5', () => {
    void refreshDividendScoreNow(env)
  })
  // cron B: 每分钟检查当日快照, 到达用户配置时刻即派发 (防重/失败重试走 NotificationLog)
  cron.schedule('* * * * *', () => {
    void dispatchDividendMail(env)
  })
  console.log('[dividend] cron started (refresh weekdays 22:43 UTC + dispatch every minute)')
}
