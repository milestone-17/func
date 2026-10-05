/**
 * 多月通知模拟脚本:
 *   过去 N 个月逐日驱动通知管线, 用真实 SMTP 发送到指定邮箱。
 *
 * 用法:
 *   cd server && npx tsx scripts/simulate-notifications.ts --months=3 --email=a@qq.com --email=b@163.com
 *   可选 --dry-run (只打印不发邮件)
 *
 * 说明:
 *   - 为两个收件人各建一个模拟用户 + 通知配置 (daily 09:00 / weekly 周一 20:00)
 *   - 逐日重放: 用当日上海时间构造 nowSh, 走 processUser 完整管线
 *     (定投建议读库内真实 index_data/fund_nav_history, 通道实时抓东财月K)
 *   - lastSentSlot 按模拟日期推进, 保证每日都命中
 *   - 结束打印汇总表
 */
import { prisma } from '../src/lib/prisma'
import { loadEnv } from '../src/env'
import { setMailerEnv, sendNotificationMail } from '../src/lib/mailer'
import { processUser, shanghaiNow, type NotifyConfigData } from '../src/lib/notification'
import { parsePush2hisKline, type MonthlyBar } from '../src/lib/channel'

const args = process.argv.slice(2)
const months = Number(args.find(a => a.startsWith('--months='))?.split('=')[1] || 2)
const emails = args.filter(a => a.startsWith('--email=')).map(a => a.split('=')[1])
const dryRun = args.includes('--dry-run')

if (!emails.length || emails.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) {
  console.error('用法: npx tsx scripts/simulate-notifications.ts --months=3 --email=xxx@qq.com [--email=yyy@163.com] [--dry-run]')
  process.exit(1)
}
if (months < 1 || months > 12) {
  console.error('--months 范围 1-12')
  process.exit(1)
}

const UT = 'fa5fd1943c7b386f172d6893dbfba10b'

async function fetchShMonthlyBars(): Promise<MonthlyBar[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent('1.000001')}&klt=103&fqt=1&lmt=10000&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55&ut=${UT}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (func-sim)' } })
  if (!res.ok) throw new Error(`东财月K HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { klines?: unknown } }
  return parsePush2hisKline(json?.data?.klines)
}

/** 过去 N 个月的日期序列 (含今天, 倒推) */
function dateRange(months: number): string[] {
  const out: string[] = []
  const end = new Date()
  const start = new Date(end.getTime() - months * 30 * 86400_000)
  for (let t = start.getTime(); t <= end.getTime(); t += 86400_000) {
    const d = new Date(t)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

interface Row {
  date: string
  email: string
  kind: string
  status: string
  detail: string
}

async function main(): Promise<void> {
  const env = loadEnv()
  setMailerEnv(env)
  if (!dryRun && (!env.smtpHost || !env.smtpUser || !env.smtpPass)) {
    console.error('SMTP 未配置, 无法真实发送 (可加 --dry-run 试跑)')
    process.exit(1)
  }

  // 通道月K只抓一次
  console.log('[sim] 抓取上证月K...')
  const bars = await fetchShMonthlyBars()
  console.log(`[sim] 月K ${bars.length} 根 (${bars[0]?.date} ~ ${bars[bars.length - 1]?.date})`)

  // 每个邮箱一个模拟用户
  const users: Array<{ userId: string; email: string; cfg: NotifyConfigData }> = []
  for (const email of emails) {
    const accountEmail = `sim-${Date.now()}-${Math.random().toString(36).slice(2)}@sim.local`
    const u = await prisma.user.create({
      data: { email: accountEmail, provider: 'email', emailVerified: true }
    })
    const cfg: NotifyConfigData = {
      enabled: true,
      notifyEmail: email,
      frequency: 'daily',
      dayOfWeek: 1,
      time: '09:00'
    }
    await prisma.notificationConfig.create({ data: { userId: u.id, data: { ...cfg } } })
    // 演示定投配置: 纳指 1000/周 (若库内有 ^NDX 数据则会给出真实建议)
    await prisma.dcaConfig.create({
      data: {
        id: `sim-${u.id}`, userId: u.id, updatedAt: new Date(),
        data: { name: '模拟-纳指定投', symbol: '^NDX', weeklySplits: [1000, 1000, 1000, 1000] }
      }
    })
    users.push({ userId: u.id, email, cfg })
    console.log(`[sim] 用户 ${u.id} → ${email} (daily 09:00)`)
  }

  const dates = dateRange(months)
  console.log(`[sim] 模拟区间: ${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length} 天)`)
  if (!dryRun) console.log(`[sim] 将真实发送约 ${dates.length * users.length} 封邮件到 ${emails.join(', ')}`)

  const rows: Row[] = []
  const transporterInfo = dryRun ? '[dry-run]' : ''

  for (const date of dates) {
    // 当日 09:00 上海时间
    const nowSh = { date, time: '09:00', dayOfWeek: new Date(`${date}T04:00:00Z`).getUTCDay() }
    // 推进 lastSentSlot 防重位 (允许每日重发)
    for (const u of users) {
      const row = await prisma.notificationConfig.findUnique({ where: { userId: u.userId } })
      const d = (row?.data || {}) as Record<string, unknown>
      await prisma.notificationConfig.update({
        where: { userId: u.userId },
        data: { data: { ...u.cfg, ...d, lastSentSlot: null, failCount: 0 } }
      })
      const outcome = await processUser({
        userId: u.userId,
        accountEmail: u.email,
        cfg: { ...u.cfg, ...(d as object) } as NotifyConfigData,
        nowSh,
        send: async (to, subject, html, text) => {
          if (dryRun) return
          await sendNotificationMail(to, `[模拟] ${subject}`, html, text)
        },
        loadChannelBars: async () => bars,
        loadShClose: async () => null
      })
      const detail = outcome.status === 'sent'
        ? (outcome.status && 'OK')
        : (outcome.error || '')
      rows.push({ date, email: u.email, kind: 'daily 09:00', status: outcome.status, detail: String(detail || '') })
    }
    process.stdout.write(`\r[sim] 进度 ${Math.round(((dates.indexOf(date) + 1) / dates.length) * 100)}%`)
  }
  console.log('')

  // 汇总
  const sent = rows.filter(r => r.status === 'sent')
  const failed = rows.filter(r => r.status === 'failed')
  console.log('\n========== 模拟汇总 ==========')
  console.log(`总尝试: ${rows.length}, 发送成功: ${sent.length}, 失败: ${failed.length}, 跳过: ${rows.length - sent.length - failed.length}`)
  const byEmail = new Map<string, number>()
  for (const r of sent) byEmail.set(r.email, (byEmail.get(r.email) || 0) + 1)
  for (const [email, n] of byEmail) console.log(`  ${email}: ${n} 封`)
  if (failed.length) {
    console.log('失败明细 (前 10):')
    for (const f of failed.slice(0, 10)) console.log(`  ${f.date} ${f.email}: ${f.detail}`)
  }
  console.log(`\n发送清单 (前 20):`)
  for (const r of rows.filter(r => r.status === 'sent').slice(0, 20)) {
    console.log(`  ${r.date} → ${r.email} [${r.kind}] ${transporterInfo}`)
  }

  // 清理模拟用户
  for (const u of users) {
    await prisma.dcaConfig.deleteMany({ where: { userId: u.userId } })
    await prisma.notificationLog.deleteMany({ where: { userId: u.userId } })
    await prisma.notificationConfig.deleteMany({ where: { userId: u.userId } })
    await prisma.user.delete({ where: { id: u.userId } })
  }
  console.log('[sim] 模拟用户已清理')
  await prisma.$disconnect()
}

main().catch(e => {
  console.error('[sim] 失败:', e)
  process.exit(1)
})
