import { describe, it, expect } from 'vitest'
import { yuanToFen, fenToYuan, formatYuan, roundYuanToFen } from '@/lib/money'

describe('money', () => {
  it('yuanToFen handles integers', () => {
    expect(yuanToFen(1)).toBe(100)
    expect(yuanToFen(0)).toBe(0)
  })
  it('yuanToFen rounds to nearest fen', () => {
    expect(yuanToFen(1.005)).toBe(101)
    expect(yuanToFen(1.004)).toBe(100)
  })
  it('yuanToFen handles negative', () => {
    expect(yuanToFen(-1.5)).toBe(-150)
  })
  it('fenToYuan', () => {
    expect(fenToYuan(100)).toBe(1)
    expect(fenToYuan(0)).toBe(0)
    expect(fenToYuan(1)).toBe(0.01)
  })
  it('roundYuanToFen', () => {
    expect(roundYuanToFen(1.005)).toBe(1.01)
    expect(roundYuanToFen(1.004)).toBe(1)
  })
  it('formatYuan formats with thousand separator and 2 decimals', () => {
    expect(formatYuan(0)).toBe('0.00')
    expect(formatYuan(100)).toBe('1.00')
    expect(formatYuan(123456789)).toBe('1,234,567.89')
    expect(formatYuan(-5000)).toBe('-50.00')
  })
})
