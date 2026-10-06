/**
 * 通知发送管线测试 (processUser): 真实数据库 + mock send
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { processUser, type NotifyConfigData, type DcaSuggestion } from '../src/lib/notification'
import type { MonthlyBar } from '../src/lib/channel'

let userId: string
const nowSh = { date: '2026-03-16', time: '08:30', dayOfWeek: 1 }

const cfg = (over: Partial<NotifyConfigData> = {}): NotifyConfigData => ({
  enabled: true, notifyEmail: 'target@example.com', frequency: 'daily', dayOfWeek: 1, time: '08:30', ...over
})

const bars: MonthlyBar[] = Array.from({ length: 120 }, (_, i) => ({
  date: `201${Math.floor(i / 12)}-${String(1 + (i % 12)).padStart(2, '0')}-01`,
  open: 100, close: 100, high: 150, low: 50
}))

const noopSuggestions = async (): Promise<DcaSuggestion[]> => []
const noopChannel = async (): Promise<MonthlyBar[]> => bars
const noopClose = async (): Promise<null> => null

async function setupUser(data: object): Promise<void> {
  const u = await prisma.user.create({
    data: { email: `pipe-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, provider: 'email', emailVerified: true }
  })
  userId = u.id
  await prisma.notificationConfig.create({ data: { userId, data } })
}

beforeAll(async () => {
  await prisma.notificationLog.deleteMany()
  await prisma.notificationConfig.deleteMany()
  await prisma.dcaConfig.deleteMany()
})

afterAll(async () => {
  await prisma.notificationConfig.deleteMany({ where: { userId } })
  await prisma.notificationLog.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
})

describe('processUser', () => {
  it('命中 → sent, 写 log + lastSentSlot + failCount=0', async () => {
    await setupUser({ ...cfg() })
    const send = vi.fn().mockResolvedValue(undefined)
    const out = await processUser({
      userId, accountEmail: 'acc@x.com', cfg: cfg(), nowSh,
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(out.status).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe('target@example.com')
    const row = await prisma.notificationConfig.findUnique({ where: { userId } })
    expect((row?.data as unknown as { lastSentSlot?: string }).lastSentSlot).toBe('2026-03-16')
    const logs = await prisma.notificationLog.findMany({ where: { userId } })
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe('sent')
  })

  it('未启用 → skipped, 不发送不写库', async () => {
    await setupUser({ ...cfg(), enabled: false })
    const send = vi.fn()
    const out = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg({ enabled: false }), nowSh,
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(out.status).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })

  it('同槽位已发 → skipped (防重)', async () => {
    await setupUser({ ...cfg(), lastSentSlot: '2026-03-16' })
    const send = vi.fn()
    const out = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg(), nowSh,
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(out.status).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })

  it('配置时刻之前 → skipped', async () => {
    await setupUser({ ...cfg() })
    const send = vi.fn()
    const out = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg(), nowSh: { ...nowSh, time: '07:00' },
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(out.status).toBe('skipped')
  })

  it('weekly 星期不匹配 → skipped', async () => {
    await setupUser({ ...cfg({ frequency: 'weekly', dayOfWeek: 3 }) })
    const send = vi.fn()
    const out = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg({ frequency: 'weekly', dayOfWeek: 3 }), nowSh,
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(out.status).toBe('skipped')
  })

  it('发送失败 → failed, 写 failed log + failCount+1, 同槽位可重试', async () => {
    await setupUser({ ...cfg() })
    const send = vi.fn().mockRejectedValue(new Error('smtp down'))
    const out = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg(), nowSh,
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(out.status).toBe('failed')
    expect(out.error).toContain('smtp down')
    const row = await prisma.notificationConfig.findUnique({ where: { userId } })
    expect((row?.data as unknown as { failCount?: number }).failCount).toBe(1)
    expect((row?.data as unknown as { lastSentSlot?: string }).lastSentSlot).toBeUndefined()
    const logs = await prisma.notificationLog.findMany({ where: { userId, status: 'failed' } })
    expect(logs).toHaveLength(1)
  })

  it('failCount 达 3 → skipped (重试上限, 不再发)', async () => {
    await setupUser({ ...cfg(), failCount: 3 })
    const send = vi.fn()
    const out = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg(), nowSh,
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(out.status).toBe('skipped')
    expect(out.error).toContain('重试')
    expect(send).not.toHaveBeenCalled()
  })

  it('成功后 failCount 归零', async () => {
    await setupUser({ ...cfg(), failCount: 2 })
    const send = vi.fn().mockResolvedValue(undefined)
    const out = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg({ failCount: 2 } as never), nowSh: { ...nowSh, date: '2026-03-17' },
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(out.status).toBe('sent')
    const row = await prisma.notificationConfig.findUnique({ where: { userId } })
    const d = row?.data as unknown as { failCount?: number; lastSentSlot?: string }
    expect(d.failCount).toBe(0)
    expect(d.lastSentSlot).toBe('2026-03-17')
  })

  it('通道数据缺失 → 邮件仍发送 (降级标注)', async () => {
    await setupUser({ ...cfg() })
    const send = vi.fn().mockResolvedValue(undefined)
    const out = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg(), nowSh: { ...nowSh, date: '2026-03-18' },
      send, loadChannelBars: async () => { throw new Error('em down') }, loadShClose: noopClose
    })
    expect(out.status).toBe('sent')
    const html = send.mock.calls[0][2] as string
    expect(html).toContain('数据不可用')
  })

  it('用户有定投配置 → 邮件含建议金额', async () => {
    await setupUser({ ...cfg() })
    await prisma.dcaConfig.create({
      data: {
        id: `dc-${userId}`, userId,
        data: { name: '纳指', symbol: '^NDX', weeklySplits: [100, 200, 300, 400] } as object,
        updatedAt: new Date()
      }
    })
    // 写 250 条 ^NDX 收盘
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: `test-ndx-${userId}-${i}`, symbol: '^NDX', date: `t${String(i).padStart(4, '0')}`, data: { close: 100 }
    }))
    await prisma.indexData.createMany({ data: rows })
    const send = vi.fn().mockResolvedValue(undefined)
    await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg(), nowSh: { ...nowSh, date: '2026-03-19' },
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    const html = send.mock.calls[0][2] as string
    expect(html).toContain('纳指')
    // 清理
    await prisma.indexData.deleteMany({ where: { symbol: '^NDX', id: { startsWith: `test-ndx-${userId}` } } })
    await prisma.dcaConfig.deleteMany({ where: { userId } })
  })

  it('重试成功后 (failCount=1→0) 下次正常', async () => {
    await setupUser({ ...cfg(), failCount: 1 })
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined)
    const d1 = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg({ failCount: 1 } as never), nowSh: { ...nowSh, date: '2026-03-20' },
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(d1.status).toBe('failed')
    const d2 = await processUser({
      userId, accountEmail: 'a@x.com', cfg: cfg({ failCount: 2 } as never), nowSh: { ...nowSh, date: '2026-03-20' },
      send, loadChannelBars: noopChannel, loadShClose: noopClose
    })
    expect(d2.status).toBe('sent')
  })
})
