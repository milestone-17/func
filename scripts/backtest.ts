import { readFileSync } from 'node:fs'

// 加载 server/.env (与 server 启动方式一致, Prisma 需要 DATABASE_URL)
const envPath = new URL('../server/.env', import.meta.url)
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

// 核心逻辑在 server/src/lib/backtest-run.ts (与 server cron 月度任务复用),
// 动态 import 保证上面的 env 加载先于 Prisma 初始化
async function main(): Promise<void> {
  const { runBacktestRefresh } = await import('../server/src/lib/backtest-run')
  await runBacktestRefresh()
}

main().catch(e => {
  console.error('脚本失败:', e)
  process.exit(1)
})
