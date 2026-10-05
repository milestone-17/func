/**
 * 通知定时调度: 每分钟扫描启用配置, 上海时区命中槽位即发送。
 * SMTP 未配置时静默跳过 (不影响主服务); 单次循环异常只记日志。
 */
import cron from 'node-cron'
import dns from 'node:dns'

// 行情源对 IPv6 出口不稳, 强制 IPv4 解析
dns.setDefaultResultOrder('ipv4first')
import { prisma } from '../lib/prisma'
import { shanghaiNow, processUser, type NotifyConfigData } from '../lib/notification'
import { sendNotificationMail } from '../lib/mailer'
import { getShMonthlyBars } from '../lib/tx-quote'
import type { Env } from '../env'

/** 上证最新日收盘从月K最后一根取 (zoneOf 用月K自身 close), 此处返回 null 走默认 */
async function loadShClose(): Promise<null> {
  return null
}

let running = false

export async function tickNotify(env?: Env): Promise<void> {
  if (running) return // 防重入
  running = true
  try {
    const nowSh = shanghaiNow()
    const configs = await prisma.notificationConfig.findMany()
    // 轻量预过滤, 只对可能命中的配置做后续 IO
    const candidates = configs.filter((c) => {
      const d = c.data as Partial<NotifyConfigData & { lastSentSlot?: string; failCount?: number }>
      if (!d?.enabled) return false
      if ((d.failCount ?? 0) >= 3) return false
      if (d.lastSentSlot === nowSh.date) return false
      if (d.time !== nowSh.time) return false
      if (d.frequency === 'weekly' && d.dayOfWeek !== nowSh.dayOfWeek) return false
      return true
    })
    if (!candidates.length) return

    if (!env?.smtpHost || !env?.smtpUser || !env?.smtpPass) {
      console.warn('[notify] SMTP 未配置, 跳过本轮通知')
      return
    }

    for (const c of candidates) {
      try {
        const u = await prisma.user.findUnique({ where: { id: c.userId }, select: { email: true, disabled: true } })
        if (!u || u.disabled) continue
        const outcome = await processUser({
          userId: c.userId,
          accountEmail: u.email,
          cfg: c.data as unknown as NotifyConfigData,
          nowSh,
          send: (to, subject, html, text) => sendNotificationMail(to, subject, html, text),
          loadChannelBars: getShMonthlyBars,
          loadShClose
        })
        if (outcome.status !== 'skipped') {
          console.log(`[notify] ${outcome.slot} ${outcome.email} ${outcome.status}${outcome.error ? ' - ' + outcome.error : ''}`)
        }
      } catch (e) {
        console.error(`[notify] 用户 ${c.userId} 处理异常:`, (e as Error).message)
      }
    }
  } catch (e) {
    console.error('[notify] tick 异常:', (e as Error).message)
  } finally {
    running = false
  }
}

let started = false

export function startNotifyCron(env: Env): void {
  if (started) return
  started = true
  cron.schedule('* * * * *', () => {
    void tickNotify(env)
  })
  console.log('[notify] cron started (every minute, Asia/Shanghai)')
}
