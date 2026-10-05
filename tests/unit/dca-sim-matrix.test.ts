/**
 * 定投模拟矩阵测试 (Task 5.2)
 * 矩阵: 周定投 × 不同起始日 × 不同金额分配 × 高/低/基准档位
 * 验证 computeWeekSuggestion 在不同偏离下的建议金额、月度合计约束、多标的独立计算
 */
import { describe, it, expect } from 'vitest'
import { computeWeekSuggestion } from '@/lib/dca'
import { lookupBucket } from '@/lib/table'
import { weekOfMonth, monthOf } from '@/lib/dcaWeek'

describe('定投模拟矩阵 · 档位判定', () => {
  it('偏离 → 档位边界值 (闭-开区间语义)', () => {
    // 高位
    expect(lookupBucket(150).rate).toBe(0)
    expect(lookupBucket(100).rate).toBe(0)
    expect(lookupBucket(99.99).rate).toBe(0.1)
    expect(lookupBucket(50).rate).toBe(0.1)
    expect(lookupBucket(49.99).rate).toBe(0.4)
    expect(lookupBucket(15).rate).toBe(0.4)
    expect(lookupBucket(14.99).rate).toBe(0.7)
    expect(lookupBucket(0.01).rate).toBe(0.7)
    // 基准
    expect(lookupBucket(0).rate).toBe(1.0)
    // 低位 (> -5 才归 1.3, 恰好 -5 落下一档 — 闭-开区间语义)
    expect(lookupBucket(-0.01).rate).toBe(1.3)
    expect(lookupBucket(-4.99).rate).toBe(1.3)
    expect(lookupBucket(-5).rate).toBe(1.6)
    expect(lookupBucket(-9.99).rate).toBe(1.6)
    expect(lookupBucket(-10.01).rate).toBe(1.9)
    expect(lookupBucket(-20.01).rate).toBe(2.2)
    expect(lookupBucket(-30.01).rate).toBe(2.5)
    expect(lookupBucket(-40.01).rate).toBe(2.8)
  })

  it('档位方向: 高位减投, 低位加投', () => {
    const high = lookupBucket(30)
    const low = lookupBucket(-25)
    expect(high.side).toBe('high')
    expect(high.rate).toBeLessThan(1)
    expect(low.side).toBe('low')
    expect(low.rate).toBeGreaterThan(1)
  })
})

describe('定投模拟矩阵 · 建议金额', () => {
  const cfg = { weeklySplits: [20000, 30000, 25000, 25000] } // 分

  it('均匀势 (dev=0): 建议额 = 计划分扣', () => {
    for (const w of [1, 2, 3, 4] as const) {
      const r = computeWeekSuggestion(cfg, { close: 100, ma250: 100 }, w)
      expect(r.suggestedAmount).toBe(cfg.weeklySplits[w - 1])
      expect(r.exceedsSplit).toBe(false)
      expect(r.bucket.rate).toBe(1.0)
    }
  })

  it('深度高位 (dev≈+120%): 建议额 = 分扣×0.1 四舍五入', () => {
    // 直接用 ma250=50 → dev=(100-50)/50=+100% 恰好归 0 档; ma250=50.5 → dev≈98% 归 0.1 档
    const r = computeWeekSuggestion(cfg, { close: 100, ma250: 50.5 }, 2)
    expect(r.bucket.rate).toBe(0.1)
    expect(r.suggestedAmount).toBe(Math.round(30000 * 0.1))
    expect(r.exceedsSplit).toBe(false)
  })

  it('极端高位 (dev>=100%): 建议额归零', () => {
    const r = computeWeekSuggestion(cfg, { close: 300, ma250: 100 }, 1)
    expect(r.bucket.rate).toBe(0)
    expect(r.suggestedAmount).toBe(0)
  })

  it('深度低位 (dev=-45%): 建议额 = 分扣×2.8, exceedsSplit=true', () => {
    const r = computeWeekSuggestion(cfg, { close: 55, ma250: 100 }, 3)
    expect(r.bucket.rate).toBe(2.8)
    expect(r.suggestedAmount).toBe(Math.round(25000 * 2.8))
    expect(r.suggestedAmount).toBeGreaterThan(cfg.weeklySplits[2])
    expect(r.exceedsSplit).toBe(true)
  })

  it('金额分配矩阵 × 档位矩阵: 4 种分扣 × 5 种偏离 = 20 组合全部正确', () => {
    const splitMatrix: Array<[number, number, number, number]> = [
      [10000, 10000, 10000, 10000],
      [40000, 30000, 20000, 10000],
      [0, 50000, 25000, 25000],
      [12500, 12500, 12500, 12500]
    ]
    // dev 与期望档位 (闭-开区间: 恰好等于边界值归更深度档)
    const devMatrix = [120, 30, 0, -15, -50]
    const expectedRates = [0, 0.4, 1.0, 1.9, 2.8]
    // 用整数 ma250 精确构造偏离, 避免浮点误差
    const maMatrix = [40, 75, 100, 115, 200]
    for (const splits of splitMatrix) {
      const c = { weeklySplits: splits }
      for (let d = 0; d < devMatrix.length; d++) {
        const close = 100
        const ma250 = maMatrix[d]
        for (const w of [1, 2, 3, 4] as const) {
          const r = computeWeekSuggestion(c, { close, ma250 }, w)
          expect(r.bucket.rate).toBe(expectedRates[d])
          expect(r.suggestedAmount).toBe(Math.round(splits[w - 1] * expectedRates[d]))
        }
      }
    }
  })

  it('weekIndex 非法 → 抛错', () => {
    expect(() => computeWeekSuggestion(cfg, { close: 100, ma250: 100 }, 0 as unknown as 1)).toThrow()
    expect(() => computeWeekSuggestion(cfg, { close: 100, ma250: 100 }, 5 as unknown as 1)).toThrow()
  })
})

describe('定投模拟矩阵 · 日期语义', () => {
  it('不同起始日 → 正确周序号 (整月覆盖)', () => {
    // 8月 2026: 1-7 W1, 8-14 W2, 15-21 W3, 22+ W4
    const days = ['2026-08-01', '2026-08-07', '2026-08-08', '2026-08-14', '2026-08-15', '2026-08-21', '2026-08-22', '2026-08-31']
    const weeks = days.map(d => weekOfMonth(d))
    expect(weeks).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('跨月模拟: 4 周全部执行后月合计 = Σ(分扣×档位系数)', () => {
    const splits = [20000, 20000, 20000, 20000]
    const cfg = { weeklySplits: splits }
    // 模拟一个月内价格从高位回落到低位
    const scenarios: Array<{ dev: number }> = [
      { dev: 20 },  // W1: 高位 0.4
      { dev: 5 },   // W2: 高位 0.7
      { dev: 0 },   // W3: 基准 1.0
      { dev: -25 }  // W4: 低位 2.2
    ]
    let total = 0
    scenarios.forEach((s, i) => {
      const close = 100
      const ma250 = 100 / (1 + s.dev / 100)
      const r = computeWeekSuggestion(cfg, { close, ma250 }, (i + 1) as 1 | 2 | 3 | 4)
      total += r.suggestedAmount
    })
    const expected = Math.round(20000 * 0.4) + Math.round(20000 * 0.7) + 20000 + Math.round(20000 * 2.2)
    expect(total).toBe(expected)
    // 低位多投补偿了高位少投: 月合计 ≥ 单周计划 × 4 的一半
    expect(total).toBeGreaterThanOrEqual(20000 * 4)
  })

  it('monthOf → YYYY-MM', () => {
    expect(monthOf('2026-08-13')).toBe('2026-08')
    expect(monthOf('2026-12-31')).toBe('2026-12')
  })

  it('非法日期容错', () => {
    expect(weekOfMonth('garbage')).toBe(1)
  })
})
