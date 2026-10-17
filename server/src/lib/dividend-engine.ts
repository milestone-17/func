/**
 * 红利分数引擎 (纯函数, 不依赖 prisma/网络, 可单测)
 * 总分 = 个股因子分×80% + 市场环境分×20%
 * 个股五因子 (权重 30/25/20/15/10, 合计即 stockScore 0~100):
 *   1. 股息率分 30: TTM 股息率样本池分位数 (越高分越高)
 *   2. 分红连续性分 25: 连续现金分红年数 ≥5 年满分, 3~4 年线性 (y/5)
 *   3. 派息率健康分 20: 10%~70% 满分; 70%~100% 线性递减到 0; >100% 或 <10% 得 10 分
 *   4. 盈利质量分 15: ROE>0 得保底 30% + ROE 样本池分位数加成 70%; ROE≤0/缺失得 0
 *   5. 低波动分 10: 年化波动率样本池分位数 (越低分越高); 缺失得中性 5 分
 * 市场环境分 (全市场共用 0~100):
 *   A 权重 60: 股债利差 5 年分位 = (中证红利股息率常数 4.6% − 10Y 国债) 的 1250 交易日分位 ×100
 *   B 权重 40: MA250 信号: 利差分位≥0.6 或 收盘>MA250 → 100; 两者皆否 → 0
 */

/** 日K线 (复用 backtest-data 的结构语义) */
export interface Bar { date: string; close: number }

/** 国债收益率点位 */
export interface YieldPoint { date: string; value: number }

/** 个股候选输入 (数据层组装) */
export interface StockInput {
  code: string
  name: string
  price: number
  marketCap: number
  amount: number
  /** TTM 股息率 (小数, 0.043 = 4.3%), 缺失为 null */
  divYield: number | null
  /** 连续现金分红年数, 缺失为 null */
  consecutiveYears: number | null
  /** 派息率 (小数), 缺失为 null */
  payoutRatio: number | null
  /** ROE (百分数值, 4.315 = 4.315%), 缺失为 null */
  roe: number | null
  /** 年化波动率 (百分数值), 缺失为 null */
  volAnnualPct: number | null
}

export interface FactorScores {
  yieldScore: number
  continuityScore: number
  payoutScore: number
  qualityScore: number
  lowVolScore: number
}

export interface StockScore {
  code: string
  name: string
  price: number
  totalScore: number
  stockScore: number
  factors: FactorScores
  /** TTM 股息率 (百分数值) */
  yieldPct: number
  consecutiveYears: number
  payoutRatio: number | null
  roe: number | null
  volAnnualPct: number | null
  rank: number
}

export interface MarketEnv {
  /** 股债利差 5 年分位 (0~1) */
  spreadPctile: number
  /** 利差分位分 (0~100) */
  spreadScore: number
  /** MA250 组合信号 (100 满仓 / 0 空仓) */
  ma250Signal: number
  marketScore: number
  tier: 'strong' | 'neutral' | 'cautious'
  tierLabel: string
  indexClose: number
  ma250: number
}

export interface DividendSnapshot {
  date: string
  sampleCount: number
  skippedCount: number
  notes: string[]
  market: MarketEnv
  stocks: StockScore[]
  generatedAt: string
}

/** 样本池容量上限 */
export const POOL_SIZE = 100
/** 股债利差分位回看窗口 (约 5 年 A 股交易日) */
export const SPREAD_WINDOW = 1250
/** 中证红利指数股息率常数 (15 年回测验证口径) */
export const CSI_DIVIDEND_YIELD_CONST = 4.6

/** 保留 n 位小数 */
function round(x: number, n = 2): number {
  const p = Math.pow(10, n)
  return Math.round(x * p) / p
}

/**
 * 平均秩分位数 (0~1): v 在 series 中的相对位置。
 * 用 (严格小于个数 + 小于等于个数) / 2n 的平均秩, 单样本时得 0.5 (中性)。
 * 空序列返回 null, 由调用方兜底中性分。
 */
export function pctileRank(series: number[], v: number): number | null {
  const n = series.length
  if (n === 0) return null
  let less = 0
  let le = 0
  for (const x of series) {
    if (x < v) less++
    if (x <= v) le++
  }
  return (less + le) / (2 * n)
}

/** 因子1 股息率分 (0~30): 池内分位 ×30, 缺失 0 */
export function scoreYield(divYield: number | null, poolYields: number[]): number {
  if (divYield === null || divYield <= 0) return 0
  const p = pctileRank(poolYields, divYield)
  return p === null ? 0 : round(p * 30)
}

/** 因子2 分红连续性分 (0~25): ≥5 年满分, 3~4 年线性 y/5, <3 年不入池 (0 保底) */
export function scoreContinuity(years: number | null): number {
  if (years === null || years < 3) return 0
  return round(25 * Math.min(years, 5) / 5)
}

/** 因子3 派息率健康分 (0~20): 10%~70% 满分; 70%~100% 线性递减到 0; >100% 或 <10% 得 10; 缺失 0 */
export function scorePayout(payoutRatio: number | null): number {
  if (payoutRatio === null) return 0
  if (payoutRatio >= 0.1 && payoutRatio <= 0.7) return 20
  if (payoutRatio > 0.7 && payoutRatio <= 1.0) return round(20 * (1.0 - payoutRatio) / 0.3)
  // >100% (透支分红) 或 <10% (分红诚意不足)
  return 10
}

/** 因子4 盈利质量分 (0~15): ROE>0 → 15×(0.3 + 0.7×ROE池内分位); ROE≤0/缺失 0 */
export function scoreQuality(roe: number | null, poolRoes: number[]): number {
  if (roe === null || roe <= 0) return 0
  const p = pctileRank(poolRoes, roe)
  return round(15 * (0.3 + 0.7 * (p ?? 0.5)))
}

/** 因子5 低波动分 (0~10): 波动率池内分位越低分越高; 缺失中性 5 */
export function scoreLowVol(volAnnualPct: number | null, poolVols: number[]): number {
  if (volAnnualPct === null) return 5
  const p = pctileRank(poolVols, volAnnualPct)
  return p === null ? 5 : round(10 * (1 - p))
}

/**
 * 市场环境分: 对齐指数日K与国债收益率的共同日期, 计算股债利差序列 (升序, 取近 SPREAD_WINDOW 个)。
 * A: 最新利差的 5 年分位 ×100; B: 分位≥0.6 或 收盘>MA250 → 100 否则 0; 总分 = A×0.6 + B×0.4
 */
export function computeMarketEnv(bars: Bar[], yields: YieldPoint[]): MarketEnv {
  const yieldByDate = new Map<string, number>()
  for (const y of yields) {
    if (Number.isFinite(y.value)) yieldByDate.set(y.date, y.value)
  }
  const spreads: number[] = []
  for (const b of bars) {
    const y = yieldByDate.get(b.date)
    if (y === undefined) continue
    spreads.push(CSI_DIVIDEND_YIELD_CONST - y)
  }
  const window = spreads.slice(-SPREAD_WINDOW)
  const last = bars.length > 0 ? bars[bars.length - 1] : null
  const indexClose = last ? last.close : 0

  // MA250: 最近 250 根收盘均值 (不足 250 根用全部)
  const tail = bars.slice(-250)
  const ma250 = tail.length > 0 ? tail.reduce((s, b) => s + b.close, 0) / tail.length : 0

  const lastSpread = window.length > 0 ? window[window.length - 1] : null
  const p = lastSpread !== null ? pctileRank(window, lastSpread) : null
  const spreadPctile = round(p ?? 0.5, 4)
  const spreadScore = round(spreadPctile * 100)
  const ma250Signal = (spreadPctile >= 0.6 || indexClose > ma250) ? 100 : 0
  const marketScore = round(spreadScore * 0.6 + ma250Signal * 0.4)
  const { tier, tierLabel } = marketScore >= 60
    ? { tier: 'strong' as const, tierLabel: '适合投入' }
    : marketScore >= 40
      ? { tier: 'neutral' as const, tierLabel: '中性' }
      : { tier: 'cautious' as const, tierLabel: '偏贵观望' }
  return { spreadPctile, spreadScore, ma250Signal, marketScore, tier, tierLabel, indexClose: round(indexClose), ma250: round(ma250) }
}

/** 池筛选: 分红连续 ≥3 年且股息率有效才入池; 按 TTM 股息率降序取 Top100; 返回 skipped 数 */
export function selectPool(candidates: StockInput[]): { pool: StockInput[]; skippedCount: number } {
  const ok = candidates.filter(s =>
    s.price > 0 && s.divYield !== null && s.divYield > 0 &&
    s.consecutiveYears !== null && s.consecutiveYears >= 3
  )
  const pool = [...ok].sort((a, b) => (b.divYield as number) - (a.divYield as number)).slice(0, POOL_SIZE)
  return { pool, skippedCount: candidates.length - ok.length }
}

/** 对样本池打分并排名 (totalScore 降序, rank 从 1 开始) */
export function scoreStocks(pool: StockInput[], marketScore: number): StockScore[] {
  const poolYields = pool.map(s => s.divYield as number)
  const poolRoes = pool.map(s => s.roe).filter((r): r is number => r !== null)
  const poolVols = pool.map(s => s.volAnnualPct).filter((v): v is number => v !== null)

  const scored = pool.map(s => {
    const factors: FactorScores = {
      yieldScore: scoreYield(s.divYield, poolYields),
      continuityScore: scoreContinuity(s.consecutiveYears),
      payoutScore: scorePayout(s.payoutRatio),
      qualityScore: scoreQuality(s.roe, poolRoes),
      lowVolScore: scoreLowVol(s.volAnnualPct, poolVols)
    }
    const stockScore = round(
      factors.yieldScore + factors.continuityScore + factors.payoutScore +
      factors.qualityScore + factors.lowVolScore
    )
    const totalScore = round(stockScore * 0.8 + marketScore * 0.2)
    return {
      code: s.code,
      name: s.name,
      price: round(s.price),
      totalScore,
      stockScore,
      factors,
      yieldPct: round((s.divYield as number) * 100),
      consecutiveYears: s.consecutiveYears as number,
      payoutRatio: s.payoutRatio === null ? null : round(s.payoutRatio, 4),
      roe: s.roe,
      volAnnualPct: s.volAnnualPct === null ? null : round(s.volAnnualPct),
      rank: 0
    }
  })
  scored.sort((a, b) => b.totalScore - a.totalScore || b.stockScore - a.stockScore)
  scored.forEach((s, i) => { s.rank = i + 1 })
  return scored
}

/** 上海时区当前日期 (UTC+8) */
export function shanghaiDate(now: Date = new Date()): string {
  const sh = new Date(now.getTime() + 8 * 3600_000)
  const y = sh.getUTCFullYear()
  const m = String(sh.getUTCMonth() + 1).padStart(2, '0')
  const d = String(sh.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 编排入口: 候选初筛 → 市场环境 → 打分 → 快照。
 * candidates 为数据层组装好的候选 (已含分红/波动率明细); bars/yields 为市场环境数据源;
 * opts.skipExtra 为数据收集阶段的额外跳过数, 并入 skippedCount。
 */
export function buildDividendSnapshot(
  candidates: StockInput[],
  bars: Bar[],
  yields: YieldPoint[],
  opts: { notes?: string[]; skipExtra?: number; now?: Date } = {}
): DividendSnapshot {
  const market = computeMarketEnv(bars, yields)
  const { pool, skippedCount } = selectPool(candidates)
  const stocks = scoreStocks(pool, market.marketScore)
  const now = opts.now ?? new Date()
  return {
    date: shanghaiDate(now),
    sampleCount: pool.length,
    skippedCount: skippedCount + (opts.skipExtra ?? 0),
    notes: opts.notes ?? [],
    market,
    stocks,
    generatedAt: now.toISOString()
  }
}
