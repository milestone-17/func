/**
 * 红利分数编排: 中证红利成分名单 → 腾讯批量快照 → 分红明细/ROE/波动率 → 市场环境 → 引擎打分 → 落库快照
 * 数据拉取原子函数在 dividend-data.ts, 本模块负责业务编排 (原子函数为跨模块调用点, 便于测试 mock)
 */
import { buildDividendSnapshot, type DividendSnapshot, type StockInput } from './dividend-engine'
import {
  fetchConstituentCodes, fetchTencentQuotes, fetchDividendInfo, fetchRoe, fetchStockVol,
  fetchIndexBars, fetchTreasuryYields, saveSnapshot
} from './dividend-data'

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** 带重试的 fn (指数/国债等单发请求, 失败等 30s 再试一次) */
async function withRetry<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`[dividend-run] ${what} 失败, 30s 后重试:`, (e as Error).message.slice(0, 80))
    await sleep(30_000)
    return fn()
  }
}

/**
 * 组装候选样本 (中证红利官方成分名单驱动, 无需全市场初筛):
 * - 新浪成分名单 100 只 → 腾讯批量快照 (价/市值) → 逐股分红明细 + ROE + 波动率
 * - 分红连续 <3 年或明细缺失 → 剔除 (并入 skippedCount)
 * 每股 3 次请求 (分红/ROE/波动率) + 400ms 间隔, 100 只约 2~3 分钟
 */
export async function collectCandidates(notes: string[]): Promise<{ candidates: StockInput[]; collectSkipped: number }> {
  const codes = await withRetry(fetchConstituentCodes, '中证红利成分名单')
  const quotes = await fetchTencentQuotes(codes)
  notes.push(`样本池: 中证红利官方成分 ${codes.length} 只 (新浪镜像名单), 快照有效 ${quotes.size} 只`)

  const candidates: StockInput[] = []
  let skipped = 0
  for (const code of codes) {
    const q = quotes.get(code)
    if (!q) { skipped++; continue }
    try {
      const info = await fetchDividendInfo(code)
      if (!info || info.consecutiveYears < 3 || info.ttmDivPerShare <= 0) {
        skipped++
        await sleep(400)
        continue
      }
      const [roe, vol] = await Promise.all([fetchRoe(code), fetchStockVol(code)])
      candidates.push({
        code,
        name: q.name,
        price: q.price,
        marketCap: q.marketCap,
        amount: q.amount,
        divYield: info.ttmDivPerShare / q.price,
        consecutiveYears: info.consecutiveYears,
        payoutRatio: info.payoutRatio,
        roe,
        volAnnualPct: vol
      })
    } catch (e) {
      console.warn(`[dividend-run] ${code} 明细拉取失败:`, (e as Error).message)
      skipped++
    }
    await sleep(400)
  }
  notes.push('TTM 股息率 = 最新除息日往前 365 天每股税前派息合计/现价 (半年分红两派可完整覆盖); 派息率 = TTM每股派息/窗口覆盖年度BASIC_EPS合计; ROE 用最新年报加权值')
  return { candidates, collectSkipped: skipped }
}

/** 主编排: 拉数 → 打分 → 落库; 任一数据源失败即抛错由调用方记日志 */
export async function runDividendRefresh(): Promise<DividendSnapshot> {
  const notes: string[] = []
  const [collected, bars, yields] = await Promise.all([
    collectCandidates(notes),
    withRetry(fetchIndexBars, '中证红利指数日K'),
    withRetry(fetchTreasuryYields, '10Y 国债收益率')
  ])
  if (collected.candidates.length === 0) throw new Error('样本池为空: 无有效分红样本')
  const snapshot = buildDividendSnapshot(collected.candidates, bars, yields, {
    notes,
    // skippedCount = 引擎池筛选跳过数 + 收集阶段跳过数 (停牌/分红数据缺失/不足3年/明细拉取失败等)
    skipExtra: collected.collectSkipped
  })
  await saveSnapshot(snapshot, snapshot.date)
  console.log(`[dividend-run] 快照完成: date=${snapshot.date} sample=${snapshot.sampleCount} skipped=${snapshot.skippedCount} market=${snapshot.market.marketScore}(${snapshot.market.tierLabel})`)
  return snapshot
}
