import { describe, it, expect, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

// 网络层 mock: 只验证 weekMa 自身的重采样/判定/路由逻辑
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))
vi.mock('@/lib/yahoo', () => ({
  fetchWeeklyBars: vi.fn(async () => null),
}))

import { isoWeekKey, resampleWeekly, weekMaStatuses, fetchWeekMaRow, WEEK_MA_PERIODS } from '@/lib/weekMa'
import { api } from '@/lib/api'
import { fetchWeeklyBars } from '@/lib/yahoo'

describe('isoWeekKey (ISO 年-周, 周一定义周首/周四定年)', () => {
  it('常规日期', () => {
    expect(isoWeekKey('2026-08-26')).toBe('2026-W35') // 周三
    expect(isoWeekKey('2026-01-05')).toBe('2026-W02') // 周一
  })

  it('跨年边界: 年初日期可属于上一 ISO 年', () => {
    expect(isoWeekKey('2023-01-01')).toBe('2022-W52') // 周日, 该周周四在 2022
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01') // 周一, 该周周四是 2026-01-01
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01') // 周四, 恰在第 1 周
  })

  it('周键可按字符串排序', () => {
    expect(isoWeekKey('2025-12-28') < isoWeekKey('2026-01-04')).toBe(true)
  })

  it('非法日期返回空串', () => {
    expect(isoWeekKey('not-a-date')).toBe('')
    expect(isoWeekKey('')).toBe('')
  })
})

describe('resampleWeekly (日频 → 周频)', () => {
  it('同周多值取最后一个, 结果按周升序', () => {
    const out = resampleWeekly([
      { date: '2026-01-05', value: 1.0 }, // W02 周一
      { date: '2026-01-07', value: 1.2 },
      { date: '2026-01-09', value: 1.1 }, // W02 周五 → 该周收盘
      { date: '2026-01-12', value: 1.3 }, // W03 周一
      { date: '2026-01-16', value: 1.4 }, // W03 周五 → 该周收盘
    ])
    expect(out).toEqual([
      { weekKey: '2026-W02', close: 1.1 },
      { weekKey: '2026-W03', close: 1.4 },
    ])
  })

  it('乱序输入先按日期排序再取周内末值', () => {
    const out = resampleWeekly([
      { date: '2026-01-09', value: 9 },
      { date: '2026-01-05', value: 5 },
      { date: '2026-01-07', value: 7 },
    ])
    expect(out).toEqual([{ weekKey: '2026-W02', close: 9 }])
  })

  it('过滤非正值/非法值', () => {
    const out = resampleWeekly([
      { date: '2026-01-05', value: 0 },
      { date: '2026-01-06', value: -1 },
      { date: '2026-01-07', value: Number.NaN },
      { date: '2026-01-08', value: 1.5 },
    ])
    expect(out).toEqual([{ weekKey: '2026-W02', close: 1.5 }])
  })
})

describe('weekMaStatuses (三档判定)', () => {
  it('上升趋势: 三档全线上', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i)
    const { statuses, weekCount } = weekMaStatuses(closes)
    expect(weekCount).toBe(60)
    expect(statuses).toHaveLength(3)
    for (const s of statuses) {
      expect(s.ma).not.toBeNull()
      expect(s.position).toBe('above')
    }
    // MA20 = 末 20 个周收盘均值
    expect(statuses[0].ma).toBeCloseTo(closes.slice(-20).reduce((a, b) => a + b, 0) / 20, 10)
  })

  it('下跌趋势: 三档全线下', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 200 - i)
    const { statuses } = weekMaStatuses(closes)
    for (const s of statuses) expect(s.position).toBe('below')
  })

  it('末值恰好等于均线记线上', () => {
    const closes = new Array(20).fill(5) // 均线恒为 5, 末值也是 5
    const { statuses } = weekMaStatuses(closes)
    expect(statuses[0]).toEqual({ period: 20, ma: 5, position: 'above' })
    expect(statuses[1]).toEqual({ period: 30, ma: null, position: null })
    expect(statuses[2]).toEqual({ period: 60, ma: null, position: null })
  })

  it('45 周历史: MA20/30 可判, MA60 数据不足', () => {
    const closes = Array.from({ length: 45 }, (_, i) => 100 + i)
    const { statuses, weekCount } = weekMaStatuses(closes)
    expect(weekCount).toBe(45)
    expect(statuses[0].position).toBe('above')
    expect(statuses[1].position).toBe('above')
    expect(statuses[2].ma).toBeNull()
    expect(statuses[2].position).toBeNull()
  })

  it('不足 20 周: 三档全数据不足', () => {
    const { statuses, weekCount } = weekMaStatuses([1, 2, 3])
    expect(weekCount).toBe(3)
    for (const s of statuses) {
      expect(s.ma).toBeNull()
      expect(s.position).toBeNull()
    }
  })

  it('周期常量', () => {
    expect([...WEEK_MA_PERIODS]).toEqual([20, 30, 60])
  })
})

describe('fetchWeekMaRow 代码路由', () => {
  afterEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(fetchWeeklyBars).mockReset()
  })

  it('6 位数字: 走服务端周线聚合 (/api/market/weekly)', async () => {
    // 服务端返回 30 根周收盘 → MA20 可算
    const bars = Array.from({ length: 30 }, (_, k) => ({ date: `2026-0${(k % 9) + 1}-15`, close: 1 + k * 0.1 }))
    vi.mocked(api.get).mockResolvedValue({ bars })
    const row = await fetchWeekMaRow({ id: 'h1', symbol: '020466', name: '红利基金' })
    expect(api.get).toHaveBeenCalledWith('/api/market/weekly?symbol=020466')
    expect(row.error).toBeUndefined()
    expect(row.weekCount).toBe(30)
    expect(row.lastValue).toBeCloseTo(1 + 29 * 0.1, 5)
    expect(row.statuses[0].position).not.toBeNull()
  })

  it('6 位数字: 服务端返回空 bars → error, 不抛', async () => {
    vi.mocked(api.get).mockResolvedValue({ bars: [] })
    const row = await fetchWeekMaRow({ id: 'a', symbol: '600519', name: 'x' })
    expect(row.error).toBe('拉取失败')
    expect(row.lastValue).toBeNull()
  })

  it('6 位数字: 请求异常 → error, 不抛', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('net'))
    const row = await fetchWeekMaRow({ id: 'a', symbol: '110022', name: 'x' })
    expect(row.error).toBe('拉取失败')
  })

  it('字母代码: 走 Yahoo 周线, bars 直接作为周收盘', async () => {
    const bars = Array.from({ length: 70 }, (_, i) => ({
      date: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`, close: 100 + i
    }))
    vi.mocked(fetchWeeklyBars).mockResolvedValue(bars)
    const row = await fetchWeekMaRow({ id: 'b', symbol: 'QQQ', name: 'x' })
    expect(fetchWeeklyBars).toHaveBeenCalledWith('QQQ')
    expect(api.get).not.toHaveBeenCalled()
    expect(row.weekCount).toBe(70)
    expect(row.lastValue).toBe(169)
    expect(row.statuses[2].position).toBe('above')
  })

  it('字母代码: 拉取失败 → error', async () => {
    vi.mocked(fetchWeeklyBars).mockResolvedValue(null)
    const row = await fetchWeekMaRow({ id: 'b', symbol: 'QQQ', name: 'x' })
    expect(row.error).toBe('拉取失败')
  })

  it('其他代码 (如港股 00700): unsupported 且不发请求', async () => {
    const row = await fetchWeekMaRow({ id: 'c', symbol: '00700', name: 'x' })
    expect(row.unsupported).toBe(true)
    expect(row.error).toBeUndefined()
    expect(api.get).not.toHaveBeenCalled()
    expect(fetchWeeklyBars).not.toHaveBeenCalled()
  })
})
