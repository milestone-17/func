/**
 * 回测引擎 · 策略 A 模拟模块
 *
 * 策略：基于 MA250 偏离率的分档定投（对齐前端 src/lib/table.ts 闭-开分桶口径）。
 * 周桶口径（与前端 src/lib/dcaWeek.ts weekOfMonth 一致）：按当月日期 1-7=第1周、8-14=第2周、
 * 15-21=第3周、22-月末=第4周，共 4 个周桶；tiered/fixed 在每个周桶内最后一个交易日各投一笔。
 * 每月基准金额 monthlyAmount：tiered 每笔 = monthlyAmount/4 × 档位系数 k（执行日收盘 vs MA250
 * 偏离查 11 档表）；k < 1 时未投部分当日进入现金池，k = 0 时该笔全额进现金池；
 * fixed 每个交易日投入 monthlyAmount ÷ 当月交易日数（按月浮动日额，档位系数恒 1，无 MA 依赖）。
 * 现金池按年化 riskFreeAnnual 日复利（按相邻 bar 间隔的自然日天数）。
 * USD 标的：投入按当日 USDCNH 汇率折算为美元份额，市值随时按 close × fx 折回 CNY。
 */
import type { Bar } from './backtest-data'

export interface StrategyAParams {
  monthlyAmount: number   // 基准月投金额，默认 1000
  feeRate: number         // 每笔费率，如 0.0005
  riskFreeAnnual: number  // 现金计息年化，固定 0.02
  mode?: 'tiered' | 'fixed' | 'lumpsum'  // 默认 'tiered'；fixed=档位系数恒 1；lumpsum=首月月初全额买入，其后不再投入
}

export interface MonthlyPoint {
  date: string        // 月末交易日日期
  invested: number    // 截至当月累计投入
  units: number       // 截至当月累计份额
  cash: number        // 当月末现金余额
  value: number       // 当月末持仓市值（CNY 计价）
  wealth: number      // value + cash
}

export interface StrategyAResult {
  totalInvested: number      // 累计实际投入本金（不含利息）
  endValue: number           // 期末总财富 = 持仓市值 + 现金余额
  totalUnits: number         // 累计份额（CNY 标的）
  cashEnd: number            // 期末现金余额
  monthly: MonthlyPoint[]    // 月粒度过程数据（供指标层与画图）
}

export interface StrategyAInput {
  bars: Bar[]                         // 日 K，升序
  currency: 'CNY' | 'USD'             // 标的币种
  fxByDate: Map<string, number>       // USD 标的必传：date -> USDCNH 汇率
  params: StrategyAParams
}

const WARMUP = 250        // MA250 需要前 250 根 bar（索引 >= 249 才有值）
const WEEK_BUCKETS = 4    // 每月 4 个周桶（日期 1-7/8-14/15-21/22-月末），各投 1/4，等效周投
const MIN_MONTH_BARS = 4  // 投入月须含 >= 4 根 bar（残月不投，调度最细粒度为周桶）

/** 第 i 根 bar 的 MA250 偏离率（%），i < 249 返回 NaN。口径与前端 deviation.ts 一致 */
export function deviationOf(bars: Bar[], i: number): number {
  if (i < WARMUP - 1) return NaN
  let sum = 0
  for (let j = i - WARMUP + 1; j <= i; j++) sum += bars[j].close
  const ma = sum / WARMUP
  if (ma === 0) return bars[i].close === 0 ? 0 : Infinity
  return ((bars[i].close - ma) / ma) * 100
}

/** 偏离率 -> 档位系数 k。边界逻辑与前端 src/lib/table.ts 的 lookupBucket 完全一致：
 *  闭-开区间 [低, 高)：高位边界用 >= 归高档，低位边界用 > 归更低档 */
export function bucketOf(dev: number): number {
  if (dev >= 100) return 0
  if (dev >= 50) return 0.1
  if (dev >= 15) return 0.4
  if (dev > 0) return 0.7
  if (dev === 0) return 1.0
  if (dev > -5) return 1.3
  if (dev > -10) return 1.6
  if (dev > -20) return 1.9
  if (dev > -30) return 2.2
  if (dev > -40) return 2.5
  return 2.8
}

/** 日期属于当月第几个周桶（1-4）：按日期 1-7/8-14/15-21/22-月末，口径与前端 dcaWeek.ts weekOfMonth 一致 */
export function weekOfMonthOf(dateISO: string): number {
  const day = +dateISO.slice(8, 10)
  if (day <= 7) return 1
  if (day <= 14) return 2
  if (day <= 21) return 3
  return 4
}

/** 两个 YYYY-MM-DD 日期之间的自然日天数 */
function daysBetween(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.round((db - da) / 86400000)
}

export interface MonthInvestSchedule {
  firstIdx: number                    // 当月首根 bar 索引
  lastIdx: number                     // 当月末根 bar 索引
  bucketLastIdx: number[]             // 长度 4：第 w 周桶内最后一个交易日的 bar 索引（无 bar 的桶为 -1）
  bucketLastDate: (string | null)[]   // 与 bucketLastIdx 对应的日期（无 bar 的桶为 null）
  tradingDays: number                 // 当月交易日数（bar 数）
}

/** 周桶投入日调度（纯函数，供测试与主模拟共用）：
 *  逐月统计各周桶（日期 1-7/8-14/15-21/22-月末）内最后一个交易日。
 *  单调扫入 bars（升序），每个 bar 只入一个桶且桶末日期随扫入更新，时间 O(bars.length)。 */
export function investDaysOf(bars: Bar[]): Map<string, MonthInvestSchedule> {
  const out = new Map<string, MonthInvestSchedule>()
  let cur: { month: string; firstIdx: number; lastIdx: number; bucketLastIdx: number[] } | null = null
  for (let i = 0; i < bars.length; i++) {
    const m = bars[i].date.slice(0, 7)
    if (!cur || cur.month !== m) {
      if (cur) {
        out.set(cur.month, {
          firstIdx: cur.firstIdx,
          lastIdx: cur.lastIdx,
          bucketLastIdx: cur.bucketLastIdx,
          bucketLastDate: cur.bucketLastIdx.map(j => (j >= 0 ? bars[j].date : null)),
          tradingDays: cur.lastIdx - cur.firstIdx + 1
        })
      }
      cur = { month: m, firstIdx: i, lastIdx: i, bucketLastIdx: [-1, -1, -1, -1] }
    }
    cur.lastIdx = i
    cur.bucketLastIdx[weekOfMonthOf(bars[i].date) - 1] = i
  }
  if (cur) {
    out.set(cur.month, {
      firstIdx: cur.firstIdx,
      lastIdx: cur.lastIdx,
      bucketLastIdx: cur.bucketLastIdx,
      bucketLastDate: cur.bucketLastIdx.map(j => (j >= 0 ? bars[j].date : null)),
      tradingDays: cur.lastIdx - cur.firstIdx + 1
    })
  }
  return out
}

/** 策略 A 主模拟：偏离分档定投 + 现金池生息，返回累计口径与月粒度过程数据。
 *  mode：'tiered' 周桶分档（默认，每周桶末交易日投 monthlyAmount/4 × k）| 'fixed' 每个交易日投
 *  月额/当月交易日数（档位恒 1，无 MA 依赖）| 'lumpsum' 一次性买入基准（首个投入月月初投满全年额度——
 *  因首月一次投满 12 个月额度，其后各月额度恒为 0，等效期初全额买入）。
 *  tiered V7 叠加三条机械规则（全部只用截至投入日的数据）：
 *  ① 趋势门控：MA20 = MA250 序列的 20 日均值；MA20 较 20 个交易日前上涨超 1% 判上行趋势，
 *     上行时当期系数 = max(档位系数, 1.0)。
 *  ② 水下加倍：收盘 < MA250（偏离率 < 0）时当期系数 = min(系数 × 2, 3.0)，先门控后加倍。
 *  ③ 弹药池：系数 < 1 时未投部分（月基准/4 × (1-系数)）计入 pool（cash 的子余额，随现金同步计息）；
 *     偏离率 < 0 的投入日释放 pool 全额加仓，随后 pool 清零。
 *  投入月：warmup 结束（bar 索引 >= 249）后的第一个完整月起，且当月须含 >= 4 根 bar（残月不投）。
 *  档位只使用执行日及以前的数据（MA250 截至当根 bar），无未来函数。 */
export function runStrategyA(input: StrategyAInput): StrategyAResult {
  const { bars, currency, fxByDate, params } = input
  if (bars.length === 0) {
    return { totalInvested: 0, endValue: 0, totalUnits: 0, cashEnd: 0, monthly: [] }
  }

  const { monthlyAmount, feeRate, riskFreeAnnual } = params
  const mode = params.mode ?? 'tiered'

  let units = 0
  let cash = 0
  let totalInvested = 0

  // V7 状态（仅 tiered）：MA250 滚动和与 MA20 增量缓存、弹药池子余额
  let ma250Sum = 0
  const ma250ByIdx: number[] = []   // 各 bar 索引处的 MA250（含 warmup 前 NaN），供 MA20 增量缓存
  const ma20ByIdx: number[] = []    // 各 bar 索引处的 MA20（不足 20 个 MA250 值时为 NaN）
  let ma20Sum = 0
  let ma20Count = 0
  let pool = 0

  // 月末交易日集合：每个月的最后一根 bar
  const monthEndSet = new Set<string>()
  let currentMonth = ''
  for (let i = 0; i < bars.length; i++) {
    const m = bars[i].date.slice(0, 7)
    if (m !== currentMonth) {
      if (currentMonth !== '') monthEndSet.add(bars[i - 1].date)
      currentMonth = m
    }
  }
  monthEndSet.add(bars[bars.length - 1].date)

  const warmupEndMonth = bars[WARMUP - 1].date.slice(0, 7)
  const schedule = investDaysOf(bars)

  // tiered/fixed：投入日集合。投入月 = 严格晚于 warmup 末根 bar 所在月且 bar 数 >= 4（残月不投，
  // 市值/现金照常计价）；tiered 投入日 = 各周桶末交易日，fixed 投入日 = 当月全部交易日
  const investDaySet = new Set<string>()
  if (mode !== 'lumpsum') {
    for (const [, s] of schedule) {
      if (s.firstIdx < WARMUP - 1) continue // 暖机期内不启动（月份不晚于 warmup 末根 bar 所在月）
      if (s.tradingDays < MIN_MONTH_BARS) continue
      if (mode === 'fixed') {
        for (let j = s.firstIdx; j <= s.lastIdx; j++) investDaySet.add(bars[j].date)
      } else {
        for (let w = 0; w < WEEK_BUCKETS; w++) {
          if (s.bucketLastIdx[w] >= 0) investDaySet.add(bars[s.bucketLastIdx[w]].date)
        }
      }
    }
  }

  // fixed 日额：monthlyAmount ÷ 当月交易日数（按月浮动日额），两遍扫描——先数出当月 bar 数再算日额
  const dailyAmountByMonth = new Map<string, number>()
  if (mode === 'fixed') {
    for (const [m, s] of schedule) dailyAmountByMonth.set(m, monthlyAmount / s.tradingDays)
  }

  // lumpsum：首个投入月月初全额买入的执行日（该月第 1 根 bar；月初全月额度为 monthlyAmount×12）
  let lumpsumDay: string | null = null
  if (mode === 'lumpsum') {
    let cur = ''
    for (let i = 0; i < bars.length; i++) {
      const m = bars[i].date.slice(0, 7)
      if (m !== cur) {
        cur = m
        if (m > warmupEndMonth) { lumpsumDay = bars[i].date; break }
      }
    }
  }

  const monthly: MonthlyPoint[] = []

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]

    // warmup 期（i < 249）：无信号，不投，现金为 0（不计息损失）
    if (i < WARMUP - 1) {
      if (monthEndSet.has(bar.date)) monthly.push({ date: bar.date, invested: 0, units: 0, cash: 0, value: 0, wealth: 0 })
      continue
    }

    // V7（tiered 专用）：更新 MA250 / MA20 增量缓存。warmup 首根 bar 起每根都有 MA250，
    // 先入后出维持 20 项滑动窗口，每日 O(1)
    if (mode === 'tiered') {
      // 滑动窗口 [i-249, i]：先入后出，O(1) 维护 MA250
      ma250Sum += bar.close
      if (i >= WARMUP) ma250Sum -= bars[i - WARMUP].close
      const ma = ma250Sum / WARMUP
      ma250ByIdx[i] = ma
      if (ma20Count === 20) ma20Sum -= ma250ByIdx[i - 20]
      ma20Sum += ma
      if (ma20Count < 20) ma20Count++
      ma20ByIdx[i] = ma20Count === 20 ? ma20Sum / 20 : NaN
    }

    // 现金池按 bar 间隔自然日数复利
    if (i > WARMUP - 1 && cash > 0) {
      const d = daysBetween(bars[i - 1].date, bar.date)
      if (d > 0) cash *= Math.pow(1 + riskFreeAnnual / 365, d)
    }
    // V7 弹药池与现金同步按相同日数复利（pool 是 cash 的子余额，不双算期末财富）
    if (i > WARMUP - 1 && pool > 0) {
      const d = daysBetween(bars[i - 1].date, bar.date)
      if (d > 0) pool *= Math.pow(1 + riskFreeAnnual / 365, d)
    }

    const fx = currency === 'USD' ? (fxByDate.get(bar.date) ?? 0) : 1

    if (mode === 'lumpsum' && bar.date === lumpsumDay) {
      // 一次性买入：全额（12 个月额度）当天买入
      totalInvested += monthlyAmount * 12
      const net = monthlyAmount * 12 * (1 - feeRate)
      if (currency === 'USD') {
        units += net / (bar.close * fx)
      } else {
        units += net / bar.close
      }
      lumpsumDay = null
    } else if (mode !== 'lumpsum' && investDaySet.has(bar.date)) {
      // tiered：每个周桶末交易日投 monthlyAmount/4 × 档位系数（执行日收盘 vs MA250 偏离）；
      // fixed：每个交易日投月额/当月交易日数，档位系数恒 1
      const sliceAmount = mode === 'fixed'
        ? (dailyAmountByMonth.get(bar.date.slice(0, 7)) ?? 0)
        : monthlyAmount / WEEK_BUCKETS
      let k = 1
      let ma = NaN
      let dev = NaN
      if (mode === 'tiered') {
        ma = ma250ByIdx[i]
        dev = ma === 0 ? (bar.close === 0 ? 0 : Infinity) : ((bar.close - ma) / ma) * 100
        k = bucketOf(dev)
        // V7 规则① 趋势门控：MA20 较 20 个交易日前上涨超 1% → 上行趋势，系数抬到至少 1
        const ma20Prev = ma20ByIdx[i - 20]
        if (Number.isFinite(ma20ByIdx[i]) && Number.isFinite(ma20Prev) && ma20ByIdx[i] / ma20Prev - 1 > 0.01) {
          k = Math.max(k, 1.0)
        }
        // V7 规则② 水下加倍：收盘 < MA250 时系数翻倍、封顶 3.0（先门控后加倍）
        if (dev < 0) k = Math.min(k * 2, 3.0)
      }
      // 投入口径：totalInvested 只累计实际从用户口袋流出的金额（k=0 也全额计入口径）
      totalInvested += sliceAmount
      let investAmt = sliceAmount * k
      // V7 规则③ 弹药池：偏离率 < 0 的投入日全额释放 pool 加仓，随后清零
      if (mode === 'tiered' && dev < 0 && pool > 0) {
        investAmt += pool
        pool = 0
      }
      if (investAmt > 0) {
        const net = investAmt * (1 - feeRate)
        if (currency === 'USD') {
          units += net / (bar.close * fx)
        } else {
          units += net / bar.close
        }
      }
      if (k < 1) {
        const withheld = sliceAmount * (1 - k)
        cash += withheld
        if (mode === 'tiered') pool += withheld
      }
    }

    if (monthEndSet.has(bar.date)) {
      const value = units * bar.close * fx
      monthly.push({
        date: bar.date,
        invested: totalInvested,
        units,
        cash,
        value,
        wealth: value + cash
      })
    }
  }

  const lastBar = bars[bars.length - 1]
  const lastFx = currency === 'USD' ? (fxByDate.get(lastBar.date) ?? 0) : 1
  return {
    totalInvested,
    endValue: units * lastBar.close * lastFx + cash,
    totalUnits: units,
    cashEnd: cash,
    monthly
  }
}

