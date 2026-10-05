import { describe, it, expect, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

import {
  parsePush2hisKline, findPivots, theilSenSlope, fitChannel, zoneOf, fetchMonthlyBars,
  PRESET_INDICES, PIVOT_WINDOW_K, type MonthlyBar, type Channel
} from '@/lib/indexChannel'

// ---------------------------------------------------------------- 合成数据

/** 36 年月 K: 底线 bottom(t)=100+8t, 顶线 top(t)=bottom+600+4t; 每 36/48 月触线; t=204,300 注入避雷针
 *  噪声用平底偏移 (±100 > 窗口内趋势漂移 72), 保证触线月稳定检出为枢轴、其余月不是 */
function synthBars(): MonthlyBar[] {
  const N = 432
  const bars: MonthlyBar[] = []
  const bottom = (t: number) => 100 + 8 * t
  const top = (t: number) => bottom(t) + 600 + 4 * t
  for (let t = 0; t < N; t++) {
    const year = 1990 + Math.floor(t / 12)
    const month = (t % 12) + 1
    const date = `${year}-${String(month).padStart(2, '0')}-28`
    const low = t % 36 === 18 ? bottom(t) : bottom(t) + 100
    const high = t % 48 === 30 ? top(t) : top(t) - 100
    const close = (low + high) / 2
    bars.push({ date, open: close, close, high, low })
  }
  bars[204] = { ...bars[204], high: top(204) * 1.6 } // 避雷针 1 (≈2007)
  bars[300] = { ...bars[300], high: top(300) * 1.4 } // 避雷针 2 (≈2015)
  return bars
}

describe('parsePush2hisKline', () => {
  it('解析 klines 行 (日期,开,收,高,低), 跳过非法行, 按日期升序', () => {
    const payload = {
      data: {
        klines: [
          '1991-02-28,129.5,133.01,134.87,128.06',
          '1990-12-31,96.05,127.61,127.61,95.79',
          'bad-row',
          '1991-03-29,-5,120.19,132.53,120.11', // 含负值 → 跳过
        ]
      }
    }
    const bars = parsePush2hisKline(payload)
    expect(bars.map(b => b.date)).toEqual(['1990-12-31', '1991-02-28'])
    expect(bars[0]).toEqual({ date: '1990-12-31', open: 96.05, close: 127.61, high: 127.61, low: 95.79 })
  })

  it('无 data.klines 返回空数组', () => {
    expect(parsePush2hisKline(null)).toEqual([])
    expect(parsePush2hisKline({ data: {} })).toEqual([])
  })
})

describe('findPivots', () => {
  it('检出局部极值, 同型间距 <2k 保留更极端者', () => {
    const k = 3
    const bars: MonthlyBar[] = []
    for (let t = 0; t < 20; t++) {
      // 低点严格递增背景, 仅 t=7 是深坑; 高点递增背景, t=6/t=8 两个高点 (间距 2 < 2k, 保留更高的 t=8)
      const low = t === 7 ? 10 : 20 + t
      const high = t === 6 ? 40 : t === 8 ? 50 : 20 + t
      bars.push({ date: `2000-${String(t + 1).padStart(2, '0')}-01`, open: 15, close: 15, high, low })
    }
    const { highs, lows } = findPivots(bars, k)
    expect(lows.map(p => p.t)).toEqual([7])
    expect(lows[0].value).toBe(10)
    expect(highs.map(p => p.t)).toEqual([8]) // 6 与 8 间距 2 < 2k=6, 保留 50 > 40
    expect(highs[0].value).toBe(50)
  })
})

describe('theilSenSlope', () => {
  it('完美线性数据返回真值', () => {
    const pts = [0, 1, 2, 3, 4].map(t => ({ t, value: 5 + 2 * t }))
    expect(theilSenSlope(pts)).toBeCloseTo(2, 10)
  })

  it('含 2 个离群点仍稳健 (中位数性质)', () => {
    const pts = [0, 1, 2, 3, 4, 5, 6].map(t => ({ t, value: 5 + 2 * t }))
    pts[2] = { t: 2, value: 500 } // 离群
    pts[5] = { t: 5, value: -300 } // 离群
    expect(theilSenSlope(pts)).toBeCloseTo(2, 10)
  })
})

describe('fitChannel (合成 36 年通道 + 2 避雷针)', () => {
  const bars = synthBars()
  const ch = fitChannel(bars)

  it('顶/低线斜率近似真值 (12 / 8)', () => {
    expect(ch.top.slope).toBeGreaterThan(11.5)
    expect(ch.top.slope).toBeLessThan(12.5)
    expect(ch.bottom.slope).toBeGreaterThan(7.5)
    expect(ch.bottom.slope).toBeLessThan(8.5)
  })

  it('剔除且仅剔除 2 根避雷针 (t=204, 300)', () => {
    expect(ch.excludedSpikes).toHaveLength(2)
    expect(ch.excludedSpikes.map(p => p.t).sort((a, b) => a - b)).toEqual([204, 300])
  })

  it('包络性质: 非剔除高点不高于顶线, 低点不低于低线', () => {
    for (const p of ch.pivotHighs) {
      expect(ch.top.slope * p.t + ch.top.intercept).toBeGreaterThanOrEqual(p.value - 1e-6)
    }
    for (const p of ch.pivotLows) {
      expect(ch.bottom.slope * p.t + ch.bottom.intercept).toBeLessThanOrEqual(p.value + 1e-6)
    }
  })

  it('枢轴数量充足 → lowConfidence = false; 线自首个枢轴画至今日', () => {
    expect(ch.lowConfidence).toBe(false)
    expect(ch.top.toT).toBe(bars.length - 1)
    expect(ch.bottom.toT).toBe(bars.length - 1)
    expect(ch.top.fromT).toBeGreaterThan(0)
  })

  it('短历史 → lowConfidence = true', () => {
    expect(fitChannel(bars.slice(0, 50)).lowConfidence).toBe(true) // <60 月
    expect(fitChannel(bars.slice(0, 20)).lowConfidence).toBe(true) // 枢轴不足
  })
})

describe('zoneOf (四区 + 百分位)', () => {
  // 手工通道: top(t)=t+1000, bottom(t)=t → tNow=100: top=1100, bottom=100, mid=600
  const ch: Channel = {
    top: { slope: 1, intercept: 1000, fromT: 0, toT: 100 },
    bottom: { slope: 1, intercept: 0, fromT: 0, toT: 100 },
    pivotHighs: [], pivotLows: [], excludedSpikes: [], lowConfidence: false
  }

  it('低于低线 → 重仓买入, pos 钳 0', () => {
    const z = zoneOf(50, ch, 100)
    expect(z.zone).toBe('strong-buy')
    expect(z.posPct).toBe(0)
  })

  it('低线~中线 → 慢慢买, pos=30', () => {
    const z = zoneOf(100 + 0.3 * 1000, ch, 100) // 400
    expect(z.zone).toBe('buy')
    expect(z.posPct).toBeCloseTo(30, 6)
  })

  it('中线~顶线 → 慢慢卖', () => {
    expect(zoneOf(700, ch, 100).zone).toBe('sell')
  })

  it('高于顶线 → 坚决卖, pos 钳 100', () => {
    const z = zoneOf(1200, ch, 100)
    expect(z.zone).toBe('strong-sell')
    expect(z.posPct).toBe(100)
  })

  it('合成序列末月收盘位于 30% → 慢慢买', () => {
    const bars = synthBars()
    const t = bars.length - 1
    const bottom = 100 + 8 * t
    const top = bottom + 600 + 4 * t
    bars[t] = { ...bars[t], close: bottom + 0.3 * (top - bottom) }
    const ch = fitChannel(bars)
    const z = zoneOf(bars[t].close, ch, t)
    expect(z.zone).toBe('buy')
    expect(z.posPct).toBeGreaterThan(20)
    expect(z.posPct).toBeLessThan(40)
  })
})

describe('fetchMonthlyBars (云端: 服务端代理)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('代理成功 → 返回 bars', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/api/market/monthly')) {
        return { ok: true, status: 200, json: async () => ({ bars: [{ date: '2026-01-31', open: 3000, close: 3100, high: 3200, low: 2950 }] }) } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }))
    const bars = await fetchMonthlyBars('1.000001')
    expect(bars).toHaveLength(1)
    expect(bars![0].close).toBe(3100)
  })

  it('代理失败 → null 不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const bars = await fetchMonthlyBars('1.000001')
    expect(bars).toBeNull()
  })

  it('代理返回空 bars → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ bars: [] }) }) as unknown as Response
    ))
    const bars = await fetchMonthlyBars('1.000001')
    expect(bars).toBeNull()
  })
})

describe('预置指数', () => {
  it('6 个预置指数, 上证指数首个 (默认)', () => {
    expect(PRESET_INDICES).toHaveLength(6)
    expect(PRESET_INDICES[0]).toEqual({ secid: '1.000001', name: '上证指数' })
    expect(PIVOT_WINDOW_K).toBe(6)
  })
})
