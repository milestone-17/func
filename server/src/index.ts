import { loadEnv } from './env'
import { buildApp } from './app'
import { prisma } from './lib/prisma'
import { startMarketCron } from './cron/market'

async function main(): Promise<void> {
  const env = loadEnv()
  const app = await buildApp(env)
  await prisma.$connect()
  startMarketCron()
  await app.listen({ port: env.port, host: '0.0.0.0' })
}

main().catch((e) => {
  console.error('启动失败:', e)
  process.exit(1)
})
