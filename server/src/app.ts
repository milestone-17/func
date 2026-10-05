import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { authRoutes } from './routes/auth'
import { crudRoutes } from './routes/crud'
import { importRoutes } from './routes/import'
import { marketRoutes } from './routes/market'
import type { Env } from './env'

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cookie)
  await app.register(jwt, { secret: env.jwtSecret, cookie: { cookieName: 'func_token', signed: false } })
  await app.register(rateLimit, { global: false })

  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }))

  await authRoutes(app, env)
  await crudRoutes(app)
  await importRoutes(app)
  await marketRoutes(app)
  return app
}
