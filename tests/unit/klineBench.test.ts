import { describe, it, expect } from 'vitest'
import { alignBenchPct, benchWindowChange } from '../../src/lib/klineBench'

const stock = Array.from({ length: 10 }, (_, i) => ({ date: `2026-01-${(i + 1).toString().padStart(2, '0')}`, close: 100 + i }))
const bench = Array.from({ length: 10 }, (_, i) => ({ date: `2026-01-${(i + 1).toString().padStart(2, '0')}`, close: 4000 + i * 40 }))

describe('alignBenchPct', () => {
  it('全窗口对齐: 相对窗口首根基准的百分比序列', () => {
    const pcts = alignBenchPct(stock, bench, 0, 10)
    expect(pcts).toHaveLength(10)
    expect(pcts[0]).toBe(0)
    expect(pcts[9]).toBeCloseTo((4360 - 4000) / 4000, 6)
  })

  it('部分窗口: 尾部对齐, 窗口起点取基准末段', () => {
    const pcts = alignBenchPct(stock, bench, 5, 5)
    expect(pcts).toHaveLength(5)
    expect(pcts[0]).toBe(0) // bench[5]=4200 为基准点
    expect(pcts[4]).toBeCloseTo((4360 - 4200) / 4200, 6)
  })

  it('基准比标的短: 无基准覆盖的头部为 null, 重叠段相对基准首根', () => {
    const short = bench.slice(5) // [4200..4360]
    const pcts = alignBenchPct(stock, short, 0, 10)
    expect(pcts[0]).toBeNull()
    expect(pcts[4]).toBeNull() // bi=-1
    expect(pcts[5]).toBe(0) // bi=0, 相对 base=short[0]=4200
    expect(pcts[9]).toBeCloseTo((4360 - 4200) / 4200, 6)
  })

  it('空输入返回空数组', () => {
    expect(alignBenchPct([], bench, 0, 5)).toEqual([])
    expect(alignBenchPct(stock, [], 0, 5)).toEqual([])
  })

  it('非法基准值(0/NaN)返回全 null', () => {
    const bad = bench.map(b => ({ ...b, close: 0 }))
    expect(alignBenchPct(stock, bad, 0, 5)).toEqual([null, null, null, null, null])
  })
})

describe('benchWindowChange', () => {
  it('取末个非空点 (%)', () => {
    expect(benchWindowChange([null, 0.01, null, 0.03])).toBeCloseTo(3, 6)
  })
  it('全空返回 null', () => {
    expect(benchWindowChange([null, null])).toBeNull()
    expect(benchWindowChange([])).toBeNull()
  })
})
