import cron from 'node-cron'
import { prisma } from '../lib/prisma'
import { fetchAllIndices } from '../lib/market-fetcher'

export async function syncMarketNow(): Promise<number> {
  const rows = await fetchAllIndices()
  if (!rows.length) {
    console.warn('[market] 本次未抓到任何数据, 保留旧数据')
    return 0
  }
  for (const r of rows) {
    await prisma.indexData.upsert({
      where: { id: `${r.symbol}::${r.date}` },
      create: { id: `${r.symbol}::${r.date}`, symbol: r.symbol, date: r.date, data: r.data as object },
      update: { data: r.data as object }
    })
  }
  console.log(`[market] 写入 ${rows.length} 行行情数据`)
  return rows.length
}

export function startMarketCron(): void {
  // UTC 22:17 周一~周五 ≈ 北京时间交易日次日 06:17 (美股收盘后)
  cron.schedule('17 22 * * 1-5', () => {
    syncMarketNow().catch(e => console.error('[market] cron 执行失败:', e.message))
  })
  // 启动时若库中无数据则立即抓一次
  prisma.indexData.count().then(n => {
    if (n === 0) syncMarketNow().catch(e => console.error('[market] 初始抓取失败:', e.message))
  })
}
