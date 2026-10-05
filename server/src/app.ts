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

  // 单容器模式: 直接服务前端 dist (base=/func/), 生产由 Caddy 反代, 本地预览直连
  if (opts.serveStatic) {
    const dist = resolve(process.cwd(), '../dist')
    if (existsSync(dist)) {
      await app.register(fastifyStatic, { root: dist, prefix: '/func/', decorateReply: true })
      // SPA fallback: /func/* 非 /api 请求回 index.html (vue-router history 模式)
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
  return app
}
