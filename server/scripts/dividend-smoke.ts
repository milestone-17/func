/**
 * 红利分数真实数据端到端冒烟 (一次性脚本, 不影响常驻服务)
 * 跑通: 全市场快照 → 初筛 → 分红明细/波动率 → 引擎打分 → 落库, 并打印快照摘要
 */
import { runDividendRefresh } from '../src/lib/dividend-run'
import { prisma } from '../src/lib/prisma'

async function main(): Promise<void> {
  const snap = await runDividendRefresh()
  const load = await prisma.indexData.findUnique({ where: { id: 'dividend-score::latest' } })
  console.log('=== SMOKE RESULT ===')
  console.log('落库行:', load ? `${load.symbol} @ ${load.date}` : 'MISSING')
  console.log('date:', snap.date, 'sample:', snap.sampleCount, 'skipped:', snap.skippedCount)
  console.log('market:', JSON.stringify(snap.market))
  console.log('notes:', snap.notes.join(' | '))
  console.log('Top5:')
  for (const s of snap.stocks.slice(0, 5)) {
    console.log(`  #${s.rank} ${s.code} ${s.name} total=${s.totalScore} stock=${s.stockScore} yield=${s.yieldPct}% years=${s.consecutiveYears} payout=${s.payoutRatio} roe=${s.roe} vol=${s.volAnnualPct}`)
  }
  await prisma.$disconnect()
}

main().catch(e => {
  console.error('SMOKE FAILED:', e)
  process.exit(1)
})
