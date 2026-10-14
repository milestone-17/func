import { loadEnv } from './env'
import { buildApp } from './app'
import { prisma } from './lib/prisma'
import { startMarketCron } from './cron/market'
import { startNotifyCron } from './cron/notify'
import { startBacktestCron } from './cron/backtest'
import { setMailerEnv } from './lib/mailer'

async function main(): Promise<void> {
  const env = loadEnv()
  const app = await buildApp(env, { serveStatic: true })
  await prisma.$connect()
  startMarketCron()
  setMailerEnv(env)
  startNotifyCron(env)
  startBacktestCron()
  await app.listen({ port: env.port, host: '0.0.0.0' })
}

main().catch((e) => {
  console.error('启动失败:', e)
  process.exit(1)
})
