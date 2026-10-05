/**
 * 即时验证: 给两个邮箱各发一封今天的真实通知邮件 (走生产渲染链路)
 */
import { prisma } from '../src/lib/prisma'
import { loadEnv } from '../src/env'
import { setMailerEnv, sendNotificationMail } from '../src/lib/mailer'
import { buildSuggestions, buildChannelSummary, renderMail, shanghaiNow } from '../src/lib/notification'
import { getShMonthlyBars } from '../src/lib/tx-quote'

async function main(): Promise<void> {
  const env = loadEnv()
  setMailerEnv(env)
  const nowSh = shanghaiNow()
  console.log(`[verify] 上海时间: ${nowSh.date} ${nowSh.time}`)

  // 抓上证月K (腾讯行情 + 缓存)
  const bars = await getShMonthlyBars()
  console.log(`[verify] 月K ${bars.length} 根, 最新 ${bars[bars.length - 1]?.date}`)
  const channel = buildChannelSummary(bars, null)
  if (channel) {
    console.log(`[verify] 通道: 中线 ${channel.mid}, 当前位 ${channel.posPct}%, 策略 ${channel.zoneLabel}`)
  }

  // 读库内真实定投配置 (管理员账号)
  const admin = await prisma.user.findUnique({ where: { email: '3451978561@qq.com' } })
  let suggestions: Awaited<ReturnType<typeof buildSuggestions>> = []
  if (admin) {
    const configs = await prisma.dcaConfig.findMany({ where: { userId: admin.id, deletedAt: null } })
    suggestions = await buildSuggestions(
      configs.map(c => ({ id: c.id, data: c.data as never })),
      async (symbol) => {
        const rows = await prisma.indexData.findMany({ where: { symbol }, orderBy: { date: 'asc' } })
        return rows.map(r => ({ date: r.date, close: Number((r.data as { close?: number }).close) }))
      },
      nowSh.date
    )
  }
  console.log(`[verify] 定投配置: ${suggestions.length} 个`)

  const mail = renderMail({ dateISO: nowSh.date, suggestions, channel, channelError: channel ? undefined : '月K数据不足' })
  console.log(`[verify] subject: ${mail.subject}`)

  for (const to of ['3451978561@qq.com', '19174291684@163.com']) {
    await sendNotificationMail(to, mail.subject, mail.html, mail.text)
    console.log(`[verify] 已发送 → ${to}`)
  }
  await prisma.$disconnect()
}

main().catch(e => { console.error('[verify] 失败:', e); process.exit(1) })
