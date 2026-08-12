import { describe, it, expect } from 'vitest'
import { computeWeekSuggestion } from '@/lib/dca'

const cfg = { weeklySplits: [200, 150, 150, 200] as [number, number, number, number] }

describe('computeWeekSuggestion', () => {
  it('基准: 偏离 0 → 当周分扣 × 100% = currentSplit', () => {
    const r = computeWeekSuggestion(cfg, { close: 100, ma250: 100 }, 1)
    expect(r.deviation).toBe(0)
    expect(r.suggestedAmount).toBe(200)
    expect(r.exceedsSplit).toBe(false)
    expect(r.bucket.label).toBe('基准')
  })

  it('高位: 偏离 +10% → 70%', () => {
    const r = computeWeekSuggestion(cfg, { close: 110, ma250: 100 }, 1)
    expect(r.suggestedAmount).toBe(140)
    expect(r.exceedsSplit).toBe(false)
  })

  it('低位: 偏离 -10% → 190% (第 2 周分扣 150, 闭-开上界归下一档)', () => {
    // -10% 落在 10-20% 桶 (1.9), 150 * 1.9 = 285
    const r = computeWeekSuggestion(cfg, { close: 90, ma250: 100 }, 2)
    expect(r.suggestedAmount).toBe(285)
    expect(r.exceedsSplit).toBe(true)
  })

  it('高位: 偏离 +14% → 70% 不超限', () => {
    // +14% 在 0-15% 桶 (rate 0.7), 200 * 0.7 = 140 < 200, 不超限
    // 注意: +20% 会落到 15-50% 桶 (rate 0.4) 不是 0.7
    const r = computeWeekSuggestion(cfg, { close: 114, ma250: 100 }, 1)
    expect(r.suggestedAmount).toBe(140)
    expect(r.exceedsSplit).toBe(false)
  })

  it('极低位: 偏离 -50% → 280%', () => {
    const r = computeWeekSuggestion(cfg, { close: 50, ma250: 100 }, 1)
    expect(r.suggestedAmount).toBe(560)
    expect(r.exceedsSplit).toBe(true)
  })

  it('极高位: 偏离 +200% → 0%', () => {
    const r = computeWeekSuggestion(cfg, { close: 300, ma250: 100 }, 1)
    expect(r.suggestedAmount).toBe(0)
  })

  it('weekIndex 越界报错', () => {
    expect(() => computeWeekSuggestion(cfg, { close: 100, ma250: 100 }, 0 as any)).toThrow()
    expect(() => computeWeekSuggestion(cfg, { close: 100, ma250: 100 }, 5 as any)).toThrow()
  })
})
