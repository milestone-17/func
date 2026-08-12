import { describe, it, expect } from 'vitest'
import { convertCurrency } from '@/lib/currency'

describe('convertCurrency', () => {
  it('same currency: no conversion', () => {
    expect(convertCurrency(10000, 'CNY', 'CNY', 7.2)).toBe(10000)
  })
  it('USD to CNY: 100 USD = 720 CNY (rate 7.2)', () => {
    expect(convertCurrency(10000, 'USD', 'CNY', 7.2)).toBe(72000)
  })
  it('CNY to USD: 720 CNY = 100 USD', () => {
    expect(convertCurrency(72000, 'CNY', 'USD', 7.2)).toBe(10000)
  })
  it('rate=0 throws', () => {
    expect(() => convertCurrency(10000, 'USD', 'CNY', 0)).toThrow()
  })
  it('rate<0 throws', () => {
    expect(() => convertCurrency(10000, 'USD', 'CNY', -1)).toThrow()
  })
})
