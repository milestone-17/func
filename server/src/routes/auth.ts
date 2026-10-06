import { FastifyInstance, FastifyReply } from 'fastify'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'
import { prisma } from '../lib/prisma'
import { sendCodeMail } from '../lib/mailer'
import { hashCode, genCode, isPurpose, verifyCode } from '../lib/codes'
import { requireAuth } from '../plugins/auth'
import type { Env } from '../env'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COOKIE = 'func_token'

function setTokenCookie(app: FastifyInstance, reply: FastifyReply, userId: string): void {
  const token = app.jwt.sign({ sub: userId }, { expiresIn: '7d' })
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600
  })
}

/** ADMIN_EMAIL 匹配 → 注册即管理员 */
function resolveRole(env: Env, email: string): string {
  return env.adminEmail && email.toLowerCase() === env.adminEmail.toLowerCase() ? 'admin' : 'user'
}

export async function authRoutes(app: FastifyInstance, env: Env): Promise<void> {
  // 发送邮箱验证码
  app.post('/api/auth/send-code', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { email, purpose } = (req.body || {}) as { email?: string; purpose?: string }
    if (!email || !EMAIL_RE.test(email) || !isPurpose(purpose)) {
      return reply.code(400).send({ error: '参数不合法' })
    }
    const norm = email.toLowerCase()
    const existing = await prisma.user.findUnique({ where: { email: norm } })
    if (purpose === 'register') {
      if (existing) return reply.code(409).send({ error: '该邮箱已注册，请直接登录' })
    } else {
      if (!existing) return reply.code(404).send({ error: '该邮箱未注册' })
    }
    const code = genCode()
    await prisma.emailCode.create({
      data: { email: norm, purpose, codeHash: hashCode(norm, code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
    })
    try {
      await sendCodeMail(env, norm, code, purpose)
    } catch (e) {
      req.log.error(e, '发送验证码失败')
      return reply.code(502).send({ error: '验证码发送失败，请稍后重试' })
    }
    return { ok: true }
  })

  // 注册
  app.post('/api/auth/register', async (req, reply) => {
    const { email, password, code } = (req.body || {}) as { email?: string; password?: string; code?: string }
    if (!email || !EMAIL_RE.test(email)) return reply.code(400).send({ error: '邮箱不合法' })
    if (!password || password.length < 8) return reply.code(400).send({ error: '密码至少 8 位' })
    if (!code) return reply.code(400).send({ error: '请输入验证码' })
    const norm = email.toLowerCase()
    const ok = await verifyCode(norm, 'register', code)
    if (!ok) return reply.code(400).send({ error: '验证码错误或已过期' })
    const existing = await prisma.user.findUnique({ where: { email: norm } })
    if (existing) return reply.code(409).send({ error: '该邮箱已注册' })
    const passwordHash = await argonHash(password)
    const user = await prisma.user.create({
      data: { email: norm, passwordHash, provider: 'email', emailVerified: true, role: resolveRole(env, norm) }
    })
    // 邮箱注册默认开启每日通知 (每日 08:30, 发往注册邮箱; 用户可在设置中修改/关闭)
    await prisma.notificationConfig.create({
      data: { userId: user.id, data: { enabled: true, notifyEmail: norm, frequency: 'daily', dayOfWeek: 1, time: '08:30' } }
    }).catch(() => { /* 已存在则忽略 */ })
    setTokenCookie(app, reply, user.id)
    return { user: { id: user.id, email: user.email, role: user.role } }
  })

  // 登录
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { email, password } = (req.body || {}) as { email?: string; password?: string }
    if (!email || !password) return reply.code(400).send({ error: '请输入邮箱和密码' })
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (!user || !user.passwordHash) return reply.code(401).send({ error: '邮箱或密码错误' })
    if (user.disabled) return reply.code(401).send({ error: '账号已被禁用' })
    const ok = await argonVerify(user.passwordHash, password)
    if (!ok) return reply.code(401).send({ error: '邮箱或密码错误' })
    setTokenCookie(app, reply, user.id)
    return { user: { id: user.id, email: user.email, role: user.role } }
  })

  // 登出
  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  // 重置密码
  app.post('/api/auth/reset-password', async (req, reply) => {
    const { email, code, newPassword } = (req.body || {}) as { email?: string; code?: string; newPassword?: string }
    if (!email || !code || !newPassword) return reply.code(400).send({ error: '参数不完整' })
    if (newPassword.length < 8) return reply.code(400).send({ error: '密码至少 8 位' })
    const norm = email.toLowerCase()
    const ok = await verifyCode(norm, 'reset', code)
    if (!ok) return reply.code(400).send({ error: '验证码错误或已过期' })
    const user = await prisma.user.findUnique({ where: { email: norm } })
    if (!user) return reply.code(404).send({ error: '该邮箱未注册' })
    const passwordHash = await argonHash(newPassword)
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })
    return { ok: true }
  })

  // 当前用户
  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    return { user: user ? { id: user.id, email: user.email, provider: user.provider, role: user.role } : null }
  })

  // 访客体验: 一键创建临时账号并登录 (限速防灌库)
  app.post('/api/auth/guest', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (_req, reply) => {
    const suffix = Math.random().toString(36).slice(2, 10)
    const user = await prisma.user.create({
      data: { email: `guest-${suffix}@guest.local`, provider: 'guest', emailVerified: true }
    })
    setTokenCookie(app, reply, user.id)
    return { user: { id: user.id, email: user.email, provider: user.provider } }
  })

  // GitHub OAuth
  app.get('/api/auth/github', async (_req, reply) => {
    if (!env.githubClientId) return reply.code(503).send({ error: 'GitHub 登录未配置' })
    const state = Math.random().toString(36).slice(2)
    reply.setCookie('gh_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 })
    const redirect = `https://github.com/login/oauth/authorize?client_id=${env.githubClientId}&state=${state}&scope=read:user%20user:email`
    return reply.redirect(redirect)
  })

  app.get('/api/auth/github/callback', async (req, reply) => {
    if (!env.githubClientId || !env.githubClientSecret) return reply.code(503).send({ error: 'GitHub 登录未配置' })
    const { code, state } = (req.query || {}) as { code?: string; state?: string }
    const saved = (req.cookies as Record<string, string | undefined>)['gh_state']
    if (!code || !state || !saved || state !== saved) return reply.code(400).send({ error: 'state 校验失败' })
    reply.clearCookie('gh_state', { path: '/' })
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: env.githubClientId, client_secret: env.githubClientSecret, code })
    })
    const tokenJson = (await tokenRes.json()) as { access_token?: string }
    if (!tokenJson.access_token) return reply.code(401).send({ error: 'GitHub 授权失败' })
    const ua = { 'user-agent': 'func-app', authorization: `Bearer ${tokenJson.access_token}` }
    const ghUser = (await (await fetch('https://api.github.com/user', { headers: ua })).json()) as { id?: number; login?: string; email?: string | null }
    if (!ghUser.id) return reply.code(401).send({ error: '获取 GitHub 用户失败' })
    let email = ghUser.email
    if (!email) {
      const emails = (await (await fetch('https://api.github.com/user/emails', { headers: ua })).json()) as Array<{ email: string; primary: boolean; verified: boolean }>
      email = Array.isArray(emails) ? (emails.find(e => e.primary && e.verified)?.email || emails[0]?.email) : undefined
    }
    if (!email) return reply.code(400).send({ error: 'GitHub 账号无可信邮箱' })
    const githubId = String(ghUser.id)
    let user = await prisma.user.findUnique({ where: { githubId } })
    if (!user) {
      const norm = email.toLowerCase()
      user = await prisma.user.findUnique({ where: { email: norm } })
      if (user) {
        user = await prisma.user.update({ where: { id: user.id }, data: { githubId, emailVerified: true } })
      } else {
        user = await prisma.user.create({ data: { email: norm, provider: 'github', githubId, emailVerified: true, role: resolveRole(env, norm) } })
      }
    }
    if (user.disabled) return reply.code(401).send({ error: '账号已被禁用' })
    setTokenCookie(app, reply, user.id)
    return reply.redirect(`${env.appUrl}/`)
  })
}
