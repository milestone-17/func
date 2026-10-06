import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { authRoutes } from './routes/auth'
import { crudRoutes } from './routes/crud'
import { importRoutes } from './routes/import'
import { marketRoutes } from './routes/market'
import { proxyRoutes } from './routes/proxy'
import { adminRoutes } from './routes/admin'
import { notificationRoutes } from './routes/notifications'
import { skillRoutes } from './routes/skills'
import type { Env } from './env'

export async function buildApp(env: Env, opts: { serveStatic?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cookie)
  await app.register(jwt, { secret: env.jwtSecret, cookie: { cookieName: 'func_token', signed: false } })
  await app.register(rateLimit, { global: false })

  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }))

  await authRoutes(app, env)
  await crudRoutes(app)
  await importRoutes(app)
  await marketRoutes(app)
  await proxyRoutes(app)
  await adminRoutes(app)
  await notificationRoutes(app)
  await skillRoutes(app)

  // 单容器模式: 直接服务前端 dist (base=/func/) + 管理后台 admin-web (base=/_admin/)
  if (opts.serveStatic) {
    const dist = resolve(process.cwd(), '../dist')
    if (existsSync(dist)) {
      await app.register(fastifyStatic, { root: dist, prefix: '/func/', decorateReply: true })
      const adminDist = resolve(process.cwd(), '../admin-web/dist')
      if (existsSync(adminDist)) {
        await app.register(fastifyStatic, {
          root: adminDist,
          prefix: '/_admin/',
          decorateReply: false
        })
        // /_admin SPA fallback (非 /api、非静态资源 → admin index.html)
        app.setNotFoundHandler(async (req, reply) => {
          const path = req.raw.url || ''
          if (path.startsWith('/func/api/') || path.startsWith('/api/')) {
            return reply.code(404).send({ error: '接口不存在' })
          }
          if (path.startsWith('/_admin')) {
            return reply.sendFile('index.html', adminDist)
          }
          if (path.startsWith('/func')) {
            return reply.sendFile('index.html', dist)
          }
          return reply.code(302).redirect('/func/')
        })
      } else {
        app.setNotFoundHandler(async (req, reply) => {
          const path = req.raw.url || ''
          if (path.startsWith('/func/api/') || path.startsWith('/api/')) {
            return reply.code(404).send({ error: '接口不存在' })
          }
          if (path.startsWith('/func')) {
            return reply.sendFile('index.html', dist)
          }
          return reply.code(302).redirect('/func/')
        })
      }
    }
  }
  return app
}
