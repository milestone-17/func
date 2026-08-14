import { describe, it, expect } from 'vitest'
import {
  computePercentile,
  bucketByPercentile,
  parseEastmoneyKline,
  parseEastmoneySnapshot,
  matchesSearch,
  BUILTIN_SYMBOLS
} from '@/lib/valuation'

describe('computePercentile', () => {
  it('空序列 → null', () => {
    expect(computePercentile([], 5)).toBe(null)
  })
  it('序列全 null → null', () => {
    expect(computePercentile([null, null, null], 5)).toBe(null)
  })
  it('含 0/负值/NaN 全部过滤', () => {
    // 过滤后 [10, 20, 30], 1 个 <= 15 → 1/3*100 = 33.33 → ceil 34
    expect(computePercentile([0, -1, NaN, 10, 20, 30], 15)).toBe(34)
  })
  it('当前值小于全部历史 → 0', () => {
    expect(computePercentile([10, 20, 30, 40, 50], 5)).toBe(0)
  })
  it('当前值大于全部历史 → 100', () => {
    expect(computePercentile([10, 20, 30, 40, 50], 100)).toBe(100)
  })
  it('当前值等于中位数 → 60', () => {
    expect(computePercentile([10, 20, 30, 40, 50], 30)).toBe(60)
  })
  it('当前值 = max → 100', () => {
    expect(computePercentile([10, 20, 30], 30)).toBe(100)
  })
  it('序列仅 1 个元素且 == current → 50 兜底', () => {
    expect(computePercentile([20], 20)).toBe(50)
  })
  it('序列仅 1 个元素但 != current → 50 兜底', () => {
    expect(computePercentile([20], 5)).toBe(50)
  })
  it('全相同值 → 50 兜底', () => {
    expect(computePercentile([20, 20, 20, 20], 20)).toBe(50)
  })
  it('当前值为 null → null', () => {
    expect(computePercentile([10, 20, 30], null)).toBe(null)
  })
  it('当前值为 undefined → null', () => {
    expect(computePercentile([10, 20, 30], undefined)).toBe(null)
  })
  it('当前值为 NaN → null', () => {
    expect(computePercentile([10, 20, 30], NaN)).toBe(null)
  })
  it('向上取整: 1/3 → 34', () => {
    // 3 元素, 1 个 <= current → 1/3*100 = 33.33 → ceil 34
    expect(computePercentile([10, 20, 30], 10)).toBe(34)
  })
  it('向上取整: 2/3 → 67', () => {
    expect(computePercentile([10, 20, 30], 20)).toBe(67)
  })
  it('含 null 元素被过滤', () => {
    expect(computePercentile([10, null, 20, null, 30], 20)).toBe(67)
  })
})

describe('bucketByPercentile', () => {
  it('p=0 → 极度低估 / 黄金坑 / green / low', () => {
    expect(bucketByPercentile(0)).toEqual({
      side: 'low', label: '极度低估', advice: '黄金坑', tone: 'green'
    })
  })
  it('p=19 → 极度低估 (< 20)', () => {
    expect(bucketByPercentile(19).side).toBe('low')
    expect(bucketByPercentile(19).label).toBe('极度低估')
  })
  it('p=20 → 低估区域 (含下界)', () => {
    expect(bucketByPercentile(20).label).toBe('低估区域')
    expect(bucketByPercentile(20).side).toBe('low')
  })
  it('p=30 → 低估区域', () => {
    expect(bucketByPercentile(30).label).toBe('低估区域')
  })
  it('p=40 → 合理估值 (含下界)', () => {
    expect(bucketByPercentile(40).label).toBe('合理估值')
    expect(bucketByPercentile(40).side).toBe('flat')
  })
  it('p=50 → 合理估值', () => {
    expect(bucketByPercentile(50).label).toBe('合理估值')
  })
  it('p=60 → 偏高估值 (含下界)', () => {
    expect(bucketByPercentile(60).label).toBe('偏高估值')
    expect(bucketByPercentile(60).side).toBe('high')
  })
  it('p=70 → 偏高估值', () => {
    expect(bucketByPercentile(70).label).toBe('偏高估值')
  })
  it('p=80 → 极度高估 (含下界)', () => {
    expect(bucketByPercentile(80).label).toBe('极度高估')
    expect(bucketByPercentile(80).side).toBe('high')
  })
  it('p=100 → 极度高估 (上界兜底)', () => {
    expect(bucketByPercentile(100).label).toBe('极度高估')
  })
  it('null → 全 null', () => {
    expect(bucketByPercentile(null)).toEqual({ side: null, label: null, advice: null, tone: null })
  })
  it('NaN → 全 null', () => {
    expect(bucketByPercentile(NaN).label).toBe(null)
  })
})

describe('parseEastmoneyKline', () => {
  it('payload 为空对象 → []', () => {
    expect(parseEastmoneyKline({})).toEqual([])
  })
  it('payload 为 null → []', () => {
    expect(parseEastmoneyKline(null)).toEqual([])
  })
  it('klines 字段缺失 → []', () => {
    expect(parseEastmoneyKline({ data: {} })).toEqual([])
  })
  it('klines 不是数组 → []', () => {
    expect(parseEastmoneyKline({ klines: 'not-array' })).toEqual([])
  })
  it('正常 K 线行 → 取出 pe_ttm 序列', () => {
    const payload = {
      klines: [
        '2024-01-02,3000,3050,3080,2990,100,200,12.5',
        '2024-01-03,3050,3100,3120,3040,110,220,13.2',
        '2024-01-04,3100,3080,3110,3070,105,210,12.8'
      ]
    }
    expect(parseEastmoneyKline(payload)).toEqual([12.5, 13.2, 12.8])
  })
  it('pe_ttm 为 0/负/非数 → 跳过', () => {
    const payload = {
      klines: [
        '2024-01-02,3000,3050,3080,2990,100,200,12.5',
        '2024-01-03,3050,3100,3120,3040,110,220,0',       // pe=0
        '2024-01-04,3100,3080,3110,3070,105,210,-1.5',    // pe<0
        '2024-01-05,3100,3080,3110,3070,105,210,abc'      // 非数
      ]
    }
    expect(parseEastmoneyKline(payload)).toEqual([12.5])
  })
  it('列数不足 8 → 跳过', () => {
    const payload = {
      klines: ['2024-01-02,3000,3050']  // 只有 3 列
    }
    expect(parseEastmoneyKline(payload)).toEqual([])
  })
})

describe('parseEastmoneySnapshot', () => {
  it('空对象 → 双 null', () => {
    expect(parseEastmoneySnapshot({})).toEqual({ peTtm: null, pb: null })
  })
  it('data 字段缺失 → 双 null', () => {
    expect(parseEastmoneySnapshot({ rc: 0 })).toEqual({ peTtm: null, pb: null })
  })
  it('正常: f9/f23 单位 ×100, 返回除以 100', () => {
    expect(parseEastmoneySnapshot({ data: { f9: 1250, f23: 350 } }))
      .toEqual({ peTtm: 12.5, pb: 3.5 })
  })
  it('f9 = 0 → peTtm null', () => {
    expect(parseEastmoneySnapshot({ data: { f9: 0, f23: 350 } }))
      .toEqual({ peTtm: null, pb: 3.5 })
  })
  it('仅 pe 缺失 → pb 仍正常', () => {
    expect(parseEastmoneySnapshot({ data: { f23: 200 } }))
      .toEqual({ peTtm: null, pb: 2.0 })
  })
})

describe('matchesSearch', () => {
  it('空 query → 全匹配', () => {
    expect(matchesSearch({ name: '沪深300', code: 'sh000300' }, '')).toBe(true)
  })
  it('空白 query → 全匹配', () => {
    expect(matchesSearch({ name: '沪深300', code: 'sh000300' }, '   ')).toBe(true)
  })
  it('中文名命中', () => {
    expect(matchesSearch({ name: '医药生物', code: 'BK0451' }, '医药')).toBe(true)
  })
  it('代码命中', () => {
    expect(matchesSearch({ name: '沪深300', code: 'sh000300' }, '300')).toBe(true)
  })
  it('大小写不敏感', () => {
    expect(matchesSearch({ name: 'Test', code: 'shTest' }, 'TEST')).toBe(true)
  })
  it('不匹配', () => {
    expect(matchesSearch({ name: '沪深300', code: 'sh000300' }, '医药')).toBe(false)
  })
})

describe('BUILTIN_SYMBOLS', () => {
  it('至少 16 个标的', () => {
    expect(BUILTIN_SYMBOLS.length).toBeGreaterThanOrEqual(16)
  })
  it('至少 6 个指数', () => {
    expect(BUILTIN_SYMBOLS.filter(s => s.kind === 'index').length).toBeGreaterThanOrEqual(6)
  })
  it('至少 10 个行业', () => {
    expect(BUILTIN_SYMBOLS.filter(s => s.kind === 'industry').length).toBeGreaterThanOrEqual(10)
  })
  it('每个标的 code 必填', () => {
    for (const s of BUILTIN_SYMBOLS) {
      expect(s.code).toBeTruthy()
      expect(s.name).toBeTruthy()
      expect(s.symbol).toBeTruthy()
    }
  })
})
