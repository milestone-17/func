import { describe, it, expect } from 'vitest'
import { addTradingDays, confirmDateOf, isSettled, suggestSettleDays } from '@/lib/settlement'

describe('addTradingDays 交易日推进 (跳过周末)', () => {
  it('周一 +1 → 周二', () => {
    expect(addTradingDays('2026-08-10', 1)).toBe('2026-08-11') // 周一
  })

  it('周四 +1 → 周五', () => {
    expect(addTradingDays('2026-08-13', 1)).toBe('2026-08-14')
  })

  it('周五 +1 → 下周一 (跳过周末)', () => {
    expect(addTradingDays('2026-08-14', 1)).toBe('2026-08-17')
  })

  it('周四 +2 → 下周一', () => {
    expect(addTradingDays('2026-08-13', 2)).toBe('2026-08-17')
  })

  it('周五 +2 → 下周二', () => {
    expect(addTradingDays('2026-08-14', 2)).toBe('2026-08-18')
  })

  it('周六下单视同下一交易日处理', () => {
    expect(addTradingDays('2026-08-15', 1)).toBe('2026-08-17') // 周六
  })
})

describe('confirmDateOf / isSettled', () => {
  it('T+1 基金: 确认日 = 下单日 + 1 交易日', () => {
    expect(confirmDateOf('2026-08-10', 1)).toBe('2026-08-11')
  })

  it('T+2 基金: 确认日 = 下单日 + 2 交易日', () => {
    expect(confirmDateOf('2026-08-13', 2)).toBe('2026-08-17')
  })

  it('settleDays<=0 (即时) 下单当日即已确认', () => {
    expect(confirmDateOf('2026-08-10', 0)).toBe('2026-08-10')
    expect(isSettled('2026-08-10', 0, '2026-08-10')).toBe(true)
  })

  it('等于确认日当天即已确认 (边界)', () => {
    expect(isSettled('2026-08-10', 1, '2026-08-11')).toBe(true) // 下单周一, 今天周二
  })

  it('确认日前一天仍未确认', () => {
    expect(isSettled('2026-08-10', 1, '2026-08-10')).toBe(false) // 今天仍是下单日
  })

  it('T+2 跨周末: 下周一确认, 下周二为已确认', () => {
    expect(isSettled('2026-08-13', 2, '2026-08-17')).toBe(true) // 周四下单, 下周一确认
  })
})

describe('suggestSettleDays 名称推断', () => {
  it('跨境 QDII 关键词 → T+2', () => {
    expect(suggestSettleDays('广发纳斯达克100ETF联接C')).toBe(2)
    expect(suggestSettleDays('富国恒生红利ETF联接C')).toBe(2)
    expect(suggestSettleDays('易方达标普500指数')).toBe(2)
    expect(suggestSettleDays('QDII 原油基金')).toBe(2)
  })

  it('国内基金 → T+1', () => {
    expect(suggestSettleDays('汇添富红利增长混合C')).toBe(1)
    expect(suggestSettleDays('招商中证白酒指数')).toBe(1)
  })

  it('空名称 → T+1', () => {
    expect(suggestSettleDays('')).toBe(1)
  })
})
