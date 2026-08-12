import { describe, it, expect } from 'vitest'
import { lookupBucket } from '@/lib/table'

describe('lookupBucket - 闭-开区间 [低,高),上界归下一档', () => {
  it('基准: deviation = 0 → 100%', () => {
    expect(lookupBucket(0)).toEqual({ rate: 1.0, label: '基准', side: 'flat' })
  })

  it('高位: 0 < x < 15 → 70%', () => {
    expect(lookupBucket(0.01).rate).toBe(0.7)
    expect(lookupBucket(7.5).rate).toBe(0.7)
    expect(lookupBucket(14.99).rate).toBe(0.7)
  })
  it('高位上界: deviation = 15 → 归下一档 40%', () => {
    expect(lookupBucket(15).rate).toBe(0.4)
  })
  it('高位: 15 ≤ x < 50 → 40%', () => {
    expect(lookupBucket(15).rate).toBe(0.4)
    expect(lookupBucket(49.99).rate).toBe(0.4)
  })
  it('高位: 50 ≤ x < 100 → 10%', () => {
    expect(lookupBucket(50).rate).toBe(0.1)
    expect(lookupBucket(99.99).rate).toBe(0.1)
  })
  it('高位: x ≥ 100 → 0%', () => {
    expect(lookupBucket(100).rate).toBe(0)
    expect(lookupBucket(200).rate).toBe(0)
  })

  it('低位: -5 < x ≤ 0 → 130%', () => {
    expect(lookupBucket(-0.01).rate).toBe(1.3)
    expect(lookupBucket(-2.5).rate).toBe(1.3)
    expect(lookupBucket(0).rate).toBe(1.0)
  })
  it('低位上界: deviation = -5 → 归下一档 160%', () => {
    expect(lookupBucket(-5).rate).toBe(1.6)
  })
  it('低位: -10 < x ≤ -5 → 160%', () => {
    expect(lookupBucket(-5).rate).toBe(1.6)
    expect(lookupBucket(-9.99).rate).toBe(1.6)
  })
  it('低位: -20 < x ≤ -10 → 190%', () => {
    expect(lookupBucket(-10).rate).toBe(1.9)
    expect(lookupBucket(-19.99).rate).toBe(1.9)
  })
  it('低位: -30 < x ≤ -20 → 220%', () => {
    expect(lookupBucket(-20).rate).toBe(2.2)
  })
  it('低位: -40 < x ≤ -30 → 250%', () => {
    expect(lookupBucket(-30).rate).toBe(2.5)
  })
  it('低位: x ≤ -40 → 280%', () => {
    expect(lookupBucket(-40).rate).toBe(2.8)
    expect(lookupBucket(-100).rate).toBe(2.8)
  })

  it('label 正确', () => {
    expect(lookupBucket(0).label).toBe('基准')
    expect(lookupBucket(10).label).toBe('高位 0-15%')
    // -10 是闭-开上界, 归下一档 "低位 10-20%"
    expect(lookupBucket(-10).label).toBe('低位 10-20%')
    expect(lookupBucket(-9.99).label).toBe('低位 5-10%')
    expect(lookupBucket(-50).label).toBe('低位 40%以上')
  })

  it('side 正确', () => {
    expect(lookupBucket(10).side).toBe('high')
    expect(lookupBucket(-10).side).toBe('low')
    expect(lookupBucket(0).side).toBe('flat')
  })
})
