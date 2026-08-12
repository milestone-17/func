import { describe, it, expect } from 'vitest'
import { computeDeviation } from '@/lib/deviation'

describe('computeDeviation', () => {
  it('returns 0 when close == ma', () => { expect(computeDeviation(100, 100)).toBe(0) })
  it('returns positive when above', () => { expect(computeDeviation(110, 100)).toBe(10) })
  it('returns negative when below', () => { expect(computeDeviation(90, 100)).toBe(-10) })
  it('returns +100 when double', () => { expect(computeDeviation(200, 100)).toBe(100) })
  it('returns -50 when halved', () => { expect(computeDeviation(50, 100)).toBe(-50) })
  it('returns Infinity when ma=0 and close>0', () => { expect(computeDeviation(100, 0)).toBe(Infinity) })
  it('returns 0 when both 0', () => { expect(computeDeviation(0, 0)).toBe(0) })
})
