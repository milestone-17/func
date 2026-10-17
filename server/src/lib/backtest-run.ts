/**
 * 回测产物生成核心逻辑: 预置 8 标的 15 年回测, 写入 public/backtest-data.json。
 * 供 scripts/backtest.ts (手动执行) 与 cron/backtest.ts (月度自动刷新) 复用。
 */
import { writeFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PRESET_TARGETS, getDailyBars, getFxUsdcnh, fillForwardFx,
  type Bar
} from './backtest-data'
import { runStrategyA } from './backtest-strategy-a'
import { runStrategyB } from './backtest-strategy-b'
import {
  metricsForWindow, sliceMonthly, computeCoreMetrics, runFixedDca, runLumpSum,
  type CoreMetrics, type WindowKey
} from './backtest-metrics'

const FEES = [0, 0.0005, 0.0015, 0.003]
const WINDOWS: WindowKey[] = ['y5', 'y10', 'full']
const DEFAULT_FEE = 0.0005
const WINDOW_POINTS: Record<WindowKey, number | null> = { y5: 60, y10: 120, full: null }
const MIN_BARS_FULL = 3600      // 与路由一致: full 需要约 15 年日K
const MIN_BARS_FALLBACK = 2500  // 兜底: 标的历史不足 15 年时按实际长度回测
const SIZE_LIMIT = 150 * 1024

// 产物路径按本文件位置定位 (src/lib 与 dist/lib 向上三级均为仓库根), 与调用方 cwd 无关
const OUTPUT_PATH = resolve(__dirname, '../../../public/backtest-data.json')

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function roundMetrics(m: CoreMetrics): CoreMetrics {
  return {
    totalInvested: round4(m.totalInvested),
    endValue: round4(m.endValue),
    totalReturnPct: round4(m.totalReturnPct),
    xirrPct: m.xirrPct === null ? null : round4(m.xirrPct),
    maxDrawdownPct: round4(m.maxDrawdownPct),
    maxDrawdownMonths: m.maxDrawdownMonths,
    annualizedVolPct: round4(m.annualizedVolPct),
    sharpe: m.sharpe === null ? null : round4(m.sharpe),
    winRatePct: round4(m.winRatePct)
  }
}

interface YearlyBreakdown {
  year: number
  invested: number
  wealth: number
  totalReturnPct: number
}

function buildYearly(monthly: { date: string; invested: number; wealth: number }[]): YearlyBreakdown[] {
  const byYear = new Map<number, { date: string; invested: number; wealth: number }>()
  for (const p of monthly) {
    const y = Number(p.date.slice(0, 4))
    const cur = byYear.get(y)
    if (!cur || p.date > cur.date) byYear.set(y, p)
  }
  return Array.from(byYear.keys()).sort((a, b) => a - b).map(y => {
    const p = byYear.get(y)!
    return {
      year: y,
      invested: round4(p.invested),
      wealth: round4(p.wealth),
      totalReturnPct: p.invested > 0 ? round4((p.wealth - p.invested) / p.invested * 100) : 0
    }
  })
}

/** 归一化净值曲线: 除以首个非零点, 保留 4 位小数 */
function normalizeWealth(monthly: { date: string; wealth: number }[]): number[] {
  const first = monthly.find(p => p.wealth > 0)?.wealth ?? 1
  return monthly.map(p => round4(p.wealth / first))
}

function daysBetween(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.round((db - da) / 86400000)
}

function monthEndDates(bars: Bar[]): Set<string> {
  const set = new Set<string>()
  let cur = ''
  for (let i = 0; i < bars.length; i++) {
    const m = bars[i].date.slice(0, 7)
    if (m !== cur) {
      if (cur !== '') set.add(bars[i - 1].date)
      cur = m
    }
  }
  set.add(bars[bars.length - 1].date)
  return set
}

/** 货币基金基准 (策略A口径): 每月末投入 monthlyAmount, 年化 2% 按日复利 */
function moneyFundMonthly(bars: Bar[], monthlyAmount: number, riskFreeAnnual: number): { date: string; wealth: number }[] {
  const ends = monthEndDates(bars)
  let cash = 0
  const monthly: { date: string; wealth: number }[] = []
  for (let i = 0; i < bars.length; i++) {
    if (i > 0 && cash > 0) {
      const d = daysBetween(bars[i - 1].date, bars[i].date)
      if (d > 0) cash *= Math.pow(1 + riskFreeAnnual / 365, d)
    }
    if (ends.has(bars[i].date)) {
      cash += monthlyAmount
      monthly.push({ date: bars[i].date, wealth: cash })
    }
  }
  return monthly
}

/** 货币基金基准 (策略B口径): initialCash 期初一次放入, 年化 2% 按日复利 */
function moneyFundLump(bars: Bar[], initialCash: number, riskFreeAnnual: number): { date: string; wealth: number }[] {
  const ends = monthEndDates(bars)
  let cash = initialCash
  const monthly: { date: string; wealth: number }[] = []
  for (let i = 0; i < bars.length; i++) {
    if (i > 0 && cash > 0) {
      const d = daysBetween(bars[i - 1].date, bars[i].date)
      if (d > 0) cash *= Math.pow(1 + riskFreeAnnual / 365, d)
    }
    if (ends.has(bars[i].date)) monthly.push({ date: bars[i].date, wealth: cash })
  }
  return monthly
}

/** 买入持有基准 (策略B口径): initialCash 在首个交易日全仓买入, 其后不动; CNY 计价 */
function buyHoldCurve(bars: Bar[], initialCash: number, currency: 'CNY' | 'USD', fxByDate: Map<string, number>): { date: string; wealth: number }[] {
  const ends = monthEndDates(bars)
  const fx0 = currency === 'USD' ? (fxByDate.get(bars[0].date) ?? 1) : 1
  const units = initialCash / (bars[0].close * fx0)
  const monthly: { date: string; wealth: number }[] = []
  for (let i = 0; i < bars.length; i++) {
    if (ends.has(bars[i].date)) {
      const fx = currency === 'USD' ? (fxByDate.get(bars[i].date) ?? fx0) : 1
      monthly.push({ date: bars[i].date, wealth: units * bars[i].close * fx })
    }
  }
  return monthly
}

/** 曲线降采样: 每 stride 个点保留一个, 始终保留首尾点 */
function downsample(arr: number[], stride: number): number[] {
  if (stride <= 1) return arr
  const out: number[] = []
  for (let i = 0; i < arr.length; i += stride) out.push(arr[i])
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1])
  return out
}

/** 跑全部预置标的回测并刷新产物文件, 异常向上抛出由调用方处理 */
export async function runBacktestRefresh(): Promise<void> {
  const fxBars = await getFxUsdcnh()
  const output: any = {
    generatedAt: new Date().toISOString(),
    targets: {}
  }

  for (const target of PRESET_TARGETS) {
    console.log(`[backtest] [${target.name}] 开始回测...`)
    let bars: Bar[] = []

    // 基金上市晚于 15 年前 (ETF 全部历史 ~3200 条), 直接用兜底阈值避免每次重复拉取;
    // 指数先按 15 年 (3600) 要求, 失败再兜底
    const minBars = target.type === 'fund' ? MIN_BARS_FALLBACK : MIN_BARS_FULL
    try {
      const res = await getDailyBars(target, minBars)
      bars = res.bars
      console.log(`[backtest] ${target.name}: ${res.source === 'db' ? '从库读取' : '实时拉取'} (${bars.length} 条)`)
    } catch (e1) {
      try {
        const res = await getDailyBars(target, MIN_BARS_FALLBACK)
        bars = res.bars
        console.log(`[backtest] ${target.name}: ${res.source === 'db' ? '从库读取' : '实时拉取'} (${bars.length} 条, 不足 15 年按实际长度回测)`)
      } catch (e2) {
        console.log(`[backtest] ${target.name}: 数据不足 - ${(e2 as Error).message}`)
      }
    }

    const fxByDate = target.currency === 'USD' && bars.length > 0
      ? fillForwardFx(fxBars, bars.map(b => b.date))
      : new Map<string, number>()

    const targetObj: any = {
      name: target.name,
      currency: target.currency,
      fees: {}
    }

    // ----- 策略 A (dca): 4 费率档 × 3 窗口 -----
    for (const fee of FEES) {
      const feeKey = String(fee)
      const windowsObj: any = {}
      let curvesObj: any = null

      if (bars.length > 0) {
        const resultA = runStrategyA({
          bars,
          currency: target.currency,
          fxByDate,
          params: { monthlyAmount: 1000, feeRate: fee, riskFreeAnnual: 0.02, mode: 'tiered' }
        })

        for (const window of WINDOWS) {
          const nPts = WINDOW_POINTS[window]
          let investedAtStart = 0
          let wealthAtStart = 0
          if (nPts !== null && resultA.monthly.length >= nPts) {
            const idx = resultA.monthly.length - nPts - 1
            investedAtStart = idx >= 0 ? resultA.monthly[idx].invested : 0
            wealthAtStart = idx >= 0 ? resultA.monthly[idx].wealth : 0
          }
          const winEntry: any = { metrics: roundMetrics(metricsForWindow(resultA.monthly, investedAtStart, window, wealthAtStart)) }
          if (fee === DEFAULT_FEE) {
            const winMonthly = sliceMonthly(resultA.monthly, window)
            if (winMonthly.length > 0) winEntry.yearly = buildYearly(winMonthly as any)
          }
          windowsObj[window] = winEntry
        }

        if (fee === DEFAULT_FEE) {
          const fixedRes = runFixedDca({
            bars, currency: target.currency, fxByDate,
            params: { monthlyAmount: 1000, feeRate: fee, riskFreeAnnual: 0.02 }
          })
          const lumpRes = runLumpSum({
            bars, currency: target.currency, fxByDate,
            params: { monthlyAmount: 1000, feeRate: fee, riskFreeAnnual: 0.02 }
          })
          curvesObj = {
            full: {
              strategy: normalizeWealth(resultA.monthly),
              benchmarkFixed: normalizeWealth(fixedRes.monthly),
              benchmarkLump: normalizeWealth(lumpRes.monthly),
              benchmarkMoneyFund: normalizeWealth(moneyFundMonthly(bars, 1000, 0.02))
            }
          }
          // 策略 B 口径基准: 仅指数 (通道标的)
          if (target.type === 'index') {
            curvesObj.full.benchmarkBuyHold = normalizeWealth(buyHoldCurve(bars, 100000, target.currency, fxByDate))
            curvesObj.full.benchmarkMoneyFundB = normalizeWealth(moneyFundLump(bars, 100000, 0.02))
          }
        }
      } else {
        for (const window of WINDOWS) {
          windowsObj[window] = { metrics: null, note: '数据不足' }
        }
      }

      targetObj.fees[feeKey] = { windows: windowsObj }
      if (curvesObj) targetObj.fees.curves = curvesObj
    }

    // ----- 策略 B (channel): 仅指数标的, 4 费率档 × 3 窗口 -----
    if (target.type === 'index') {
      targetObj.channel = {}
      for (const fee of FEES) {
        const feeKey = String(fee)
        const windowsObj: any = {}
        if (bars.length > 0) {
          const resultB = runStrategyB({
            bars,
            currency: target.currency,
            fxByDate,
            params: {
              initialCash: 100000, monthlyBuyStrong: 2000, monthlyBuy: 1000,
              sellTrimPct: 0.25, feeRate: fee, riskFreeAnnual: 0.02
            }
          })
          for (const window of WINDOWS) {
            const sliced = sliceMonthly(resultB.monthly, window)
            windowsObj[window] = {
              metrics: roundMetrics(computeCoreMetrics(sliced, window === 'full' ? 100000 : (sliced[0]?.wealth ?? 0)))
            }
          }
        } else {
          for (const window of WINDOWS) {
            windowsObj[window] = { metrics: null, note: '数据不足' }
          }
        }
        targetObj.channel[feeKey] = { windows: windowsObj }
      }
    }

    output.targets[target.secid] = targetObj

    // 摘要: 策略A fee=0.0005 window=full
    const sm = targetObj.fees[String(DEFAULT_FEE)]?.windows?.full?.metrics
    if (sm) {
      const xirr = sm.xirrPct !== null ? `${sm.xirrPct.toFixed(2)}%` : 'N/A'
      console.log(`[backtest] [摘要] ${target.name} | xirr=${xirr} | 总收益=${sm.totalReturnPct.toFixed(2)}% | 最大回撤=${sm.maxDrawdownPct.toFixed(2)}%`)
    } else {
      console.log(`[backtest] [摘要] ${target.name} | 数据不足`)
    }
  }

  // 写入产物, 超体积则对曲线降采样
  let stride = 1
  for (;;) {
    const out = stride === 1 ? output : {
      ...output,
      targets: Object.fromEntries(Object.entries(output.targets).map(([k, t]: [string, any]) => {
        const c = t.fees?.curves
        if (!c) return [k, t]
        const full: any = {}
        for (const [ck, cv] of Object.entries(c.full)) full[ck] = downsample(cv as number[], stride)
        return [k, { ...t, fees: { ...t.fees, curves: { full } } }]
      }))
    }
    writeFileSync(OUTPUT_PATH, JSON.stringify(out))
    const size = statSync(OUTPUT_PATH).size
    console.log(`[backtest] 产物已写入 public/backtest-data.json (${(size / 1024).toFixed(1)} KB, 曲线降采样步长=${stride})`)
    if (size <= SIZE_LIMIT || stride >= 8) {
      if (size > SIZE_LIMIT) console.warn('[backtest] 警告: 降采样后仍超过 150KB')
      break
    }
    stride *= 2
    console.log('[backtest] 超过 150KB, 曲线降采样重试...')
  }
}
