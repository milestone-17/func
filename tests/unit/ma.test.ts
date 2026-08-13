import { describe, it, expect } from 'vitest'
import { computeMA250, computeMA } from '@/lib/ma'

describe('computeMA250', () => {
  it('returns null when length < 250', () => {
    expect(computeMA250(new Array(249).fill(100))).toBeNull()
    expect(computeMA250([])).toBeNull()
  })
  it('returns average of last 250 closes when exactly 250', () => {
    const arr = new Array(250).fill(0).map((_, i) => i + 1)
    expect(computeMA250(arr)).toBe(125.5)
  })
  it('ignores nulls: returns null if any of last 250 is null', () => {
    const arr = new Array(250).fill(100)
    arr[100] = null
    expect(computeMA250(arr)).toBeNull()
  })
  it('uses only last 250 elements when more provided', () => {
    const arr = [...new Array(10).fill(0), ...new Array(250).fill(100)]
    expect(computeMA250(arr)).toBe(100)
  })
})

describe('computeMA (通用, 含 MA180)', () => {
  it('MA180: 数据不足 180 返回 null', () => {
    expect(computeMA(new Array(179).fill(100), 180)).toBeNull()
    expect(computeMA([], 180)).toBeNull()
  })
  it('MA180: ≥180 返回末 180 个均值', () => {
    const arr = new Array(180).fill(0).map((_, i) => i + 1) // 1..180 均值 90.5
    expect(computeMA(arr, 180)).toBe(90.5)
  })
  it('MA180: 窗口含 null 返回 null', () => {
    const arr = new Array(180).fill(100)
    arr[5] = null
    expect(computeMA(arr, 180)).toBeNull()
  })
  it('MA120 与 MA250 同一函数口径一致', () => {
    const arr = new Array(250).fill(10)
    expect(computeMA(arr, 120)).toBe(10)
    expect(computeMA(arr, 250)).toBe(10)
  })
  it('period ≤ 0 返回 null', () => {
    expect(computeMA([1, 2, 3], 0)).toBeNull()
  })
})
