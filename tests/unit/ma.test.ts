import { describe, it, expect } from 'vitest'
import { computeMA250 } from '@/lib/ma'

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
