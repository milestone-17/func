/**
 * 通知设置 API 测试: 默认值/校验/隔离/测试邮件/日志
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { buildApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { loadEnv } from '../src/env'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let cookieA = ''
let cookieB = ''
let emailA: string
let emailB: string

async function mkUser(suffix: string): Promise<string> {
  const email = `notify-${suffix}-${Date.now()}@test.local`
  const u = await prisma.user.create({ data: { email, provider: 'email', emailVerified: true } })
  const token = app.jwt.sign({ sub: u.id })
  return `${email}|func_token=${token}`
}

beforeAll(async () => {
  app = await buildApp(loadEnv())
  ;[cookieA, cookieB] = await Promise.all([mkUser('a'), mkUser('b')])
  ;[emailA, emailB] = [cookieA.split('|')[0], cookieB.split('|')[0]]
  cookieA = cookieA.split('|')[1]
  cookieB = cookieB.split('|')[1]
})

afterAll(async () => {
  await prisma.notificationLog.deleteMany()
  await prisma.notificationConfig.deleteMany()
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await app.close()
  await prisma.$disconnect()
})

describe('GET /api/notifications/config', () => {
  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications/config' })
    expect(res.statusCode).toBe(401)
  })
  it('首次 → 默认配置 (notifyEmail=账号邮箱, enabled=false)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications/config', headers: { cookie: cookieA } })
    expect(res.statusCode).toBe(200)
    const c = res.json().config
    expect(c.enabled).toBe(false)
    expect(c.notifyEmail).toBe(emailA)
    expect(c.frequency).toBe('daily')
    expect(c.time).toBe('08:30')
  })
  it('隔离: A 的查询不返回 B 数据', async () => {
    const resA = await app.inject({ method: 'GET', url: '/api/notifications/config', headers: { cookie: cookieA } })
    expect(resA.json().config.notifyEmail).toBe(emailA)
  })
})

describe('PUT /api/notifications/config', () => {
  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/notifications/config', payload: {} })
    expect(res.statusCode).toBe(401)
  })
  it('合法更新: enabled/邮箱/weekly/周几/时间', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/notifications/config', headers: { cookie: cookieA },
      payload: { enabled: true, notifyEmail: 'New@Example.COM', frequency: 'weekly', dayOfWeek: 3, time: '20:00' }
    })
    expect(res.statusCode).toBe(200)
    const c = res.json().config
    expect(c.enabled).toBe(true)
    expect(c.notifyEmail).toBe('new@example.com') // 规范化小写
    expect(c.frequency).toBe('weekly')
    expect(c.dayOfWeek).toBe(3)
    expect(c.time).toBe('20:00')
  })
  it('非法 frequency → 400', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/notifications/config', headers: { cookie: cookieA }, payload: { frequency: 'monthly' } })
    expect(res.statusCode).toBe(400)
  })
  it('非法 time: 25:00 / 7:00 格式 / 08:5x → 400', async () => {
    for (const time of ['25:00', '7:00', '08:5x', '24:00', '23:60']) {
      const res = await app.inject({ method: 'PUT', url: '/api/notifications/config', headers: { cookie: cookieA }, payload: { time } })
      expect(res.statusCode).toBe(400)
    }
  })
  it('边界 time: 00:00 与 23:59 合法', async () => {
    for (const time of ['00:00', '23:59']) {
      const res = await app.inject({ method: 'PUT', url: '/api/notifications/config', headers: { cookie: cookieA }, payload: { time } })
      expect(res.statusCode).toBe(200)
    }
  })
  it('非法 dayOfWeek: -1 / 7 / 1.5 / "x" → 400', async () => {
    for (const dayOfWeek of [-1, 7, 1.5, 'x']) {
      const res = await app.inject({ method: 'PUT', url: '/api/notifications/config', headers: { cookie: cookieA }, payload: { dayOfWeek } })
      expect(res.statusCode).toBe(400)
    }
  })
  it('边界 dayOfWeek: 0 与 6 合法', async () => {
    for (const dayOfWeek of [0, 6]) {
      const res = await app.inject({ method: 'PUT', url: '/api/notifications/config', headers: { cookie: cookieA }, payload: { dayOfWeek } })
      expect(res.statusCode).toBe(200)
    }
  })
  it('非法邮箱 → 400, 配置不变', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/notifications/config', headers: { cookie: cookieA } })
    const res = await app.inject({ method: 'PUT', url: '/api/notifications/config', headers: { cookie: cookieA }, payload: { notifyEmail: 'not-an-email' } })
    expect(res.statusCode).toBe(400)
    const after = await app.inject({ method: 'GET', url: '/api/notifications/config', headers: { cookie: cookieA } })
    expect(after.json().config).toEqual(before.json().config)
  })
  it('enabled 非布尔 → 400', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/notifications/config', headers: { cookie: cookieA }, payload: { enabled: 'yes' } })
    expect(res.statusCode).toBe(400)
  })
  it('隔离: B 更新不影响 A', async () => {
    await app.inject({ method: 'PUT', url: '/api/notifications/config', headers: { cookie: cookieB }, payload: { notifyEmail: 'b-own@example.com' } })
    const resA = await app.inject({ method: 'GET', url: '/api/notifications/config', headers: { cookie: cookieA } })
    expect(resA.json().config.notifyEmail).not.toBe('b-own@example.com')
  })
})

describe('POST /api/notifications/test', () => {
  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/notifications/test' })
    expect(res.statusCode).toBe(401)
  })
  it('SMTP 可用时发送成功 (本地 dev SMTP stub 环境)', async () => {
    // 测试环境 SMTP_HOST=localhost 无真实服务 → 502; mock sendTestMail 验证调用链
    const mod = await import('../src/lib/mailer')
    const spy = vi.spyOn(mod, 'sendTestMail').mockResolvedValue(undefined)
    const res = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie: cookieA } })
    expect(res.statusCode).toBe(200)
    expect(spy).toHaveBeenCalledWith('new@example.com')
    spy.mockRestore()
  })
  it('SMTP 失败 → 502 与错误信息', async () => {
    const mod = await import('../src/lib/mailer')
    const spy = vi.spyOn(mod, 'sendTestMail').mockRejectedValue(new Error('conn refused'))
    const res = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie: cookieB } })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toContain('conn refused')
    spy.mockRestore()
  })
})

describe('GET /api/notifications/logs', () => {
  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications/logs' })
    expect(res.statusCode).toBe(401)
  })
  it('只返回本人日志', async () => {
    const me = await prisma.user.findUnique({ where: { email: emailA } })
    await prisma.notificationLog.create({ data: { userId: me!.id, slot: '2026-03-16', status: 'sent' } })
    const res = await app.inject({ method: 'GET', url: '/api/notifications/logs', headers: { cookie: cookieA } })
    expect(res.statusCode).toBe(200)
    const logs = res.json().logs
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs.every((l: { userId: string }) => l.userId === me!.id)).toBe(true)
  })
})


// ---------------------------------------------------------------- 注册默认通知

describe('邮箱注册默认通知配置', () => {
  it('邮箱注册后 GET config → enabled=true, notifyEmail=注册邮箱, daily 08:30', async () => {
    const email = 'newreg@test.com'
    await prisma.emailCode.create({
      data: { email, purpose: 'register', codeHash: require('node:crypto').createHash('sha256').update(`${email}::123456`).digest('hex'), expiresAt: new Date(Date.now() + 600000) }
    })
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password123', code: '123456' } })
    expect(reg.statusCode).toBe(200)
    const cookie = reg.cookies.map(c => `${c.name}=${c.value}`).join('; ')
    const res = await app.inject({ method: 'GET', url: '/api/notifications/config', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const c = res.json().config
    expect(c.enabled).toBe(true)
    expect(c.notifyEmail).toBe(email)
    expect(c.frequency).toBe('daily')
    expect(c.time).toBe('08:30')
    // 清理
    const u = await prisma.user.findUnique({ where: { email } })
    if (u) {
      await prisma.notificationConfig.deleteMany({ where: { userId: u.id } })
      await prisma.notificationLog.deleteMany({ where: { userId: u.id } })
      await prisma.emailCode.deleteMany({ where: { email } })
      await prisma.user.delete({ where: { id: u.id } })
    }
  })

  it('guest 注册不创建通知配置 → GET config 走默认 enabled=false', async () => {
    const g = await app.inject({ method: 'POST', url: '/api/auth/guest' })
    expect(g.statusCode).toBe(200)
    const cookie = g.cookies.map(c => `${c.name}=${c.value}`).join('; ')
    const res = await app.inject({ method: 'GET', url: '/api/notifications/config', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const c = res.json().config
    expect(c.enabled).toBe(false)
    // 清理
    const gid = g.json().user.id
    await prisma.notificationConfig.deleteMany({ where: { userId: gid } })
    await prisma.notificationLog.deleteMany({ where: { userId: gid } })
    await prisma.user.deleteMany({ where: { id: gid } })
  })
})
