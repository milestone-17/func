/**
 * 通知引擎纯函数测试: 槽位/时区/防重/内容构建/通道 — 全边界覆盖
 */
import { describe, it, expect } from 'vitest'
import {
  shanghaiNow, timeToMinutes, shouldFire, weekOfMonthOf,
  ma250Of, buildSuggestions, buildChannelSummary, renderMail,
  type NotifyConfigData, type DcaConfigLike, type IndexCloseRow
} from '../src/lib/notification'
import { parsePush2hisKline, findPivots, theilSenSlope, fitChannel, zoneOf } from '../src/lib/channel'

// ---------------------------------------------------------------- 上海时间

describe('shanghaiNow', () => {
  it('UTC 00:30 → 上海 08:30 同日', () => {
    const r = shanghaiNow(new Date('2026-03-15T00:30:00Z'))
    expect(r.date).toBe('2026-03-15')
    expect(r.time).toBe('08:30')
  })
  it('UTC 16:00 → 上海次日 00:00 (跨日)', () => {
    const r = shanghaiNow(new Date('2026-03-15T16:00:00Z'))
    expect(r.date).toBe('2026-03-16')
    expect(r.time).toBe('00:00')
  })
  it('UTC 15:59 → 上海 23:59 (当日最后一分钟)', () => {
    const r = shanghaiNow(new Date('2026-03-15T15:59:00Z'))
    expect(r.date).toBe('2026-03-15')
    expect(r.time).toBe('23:59')
  })
  it('星期计算: 2026-03-15 是周日 (dayOfWeek=0)', () => {
    const r = shanghaiNow(new Date('2026-03-15T00:00:00Z'))
    expect(r.dayOfWeek).toBe(0)
  })
  it('星期计算: 2026-03-21 是周六 (dayOfWeek=6)', () => {
    const r = shanghaiNow(new Date('2026-03-20T20:00:00Z'))
    expect(r.dayOfWeek).toBe(6)
  })
  it('minutes: 08:30 → 510', () => {
    const r = shanghaiNow(new Date('2026-03-15T00:30:00Z'))
    expect(r.minutes).toBe(510)
  })
})

describe('timeToMinutes', () => {
  it('00:00 → 0', () => expect(timeToMinutes('00:00')).toBe(0))
  it('23:59 → 1439', () => expect(timeToMinutes('23:59')).toBe(1439))
  it('08:30 → 510', () => expect(timeToMinutes('08:30')).toBe(510))
})

// ---------------------------------------------------------------- 槽位

const baseCfg = (over: Partial<NotifyConfigData> = {}): NotifyConfigData => ({
  enabled: true, notifyEmail: 'a@b.com', frequency: 'daily', dayOfWeek: 1, time: '08:30', ...over
})

describe('shouldFire', () => {
  const now0830 = { date: '2026-03-16', time: '08:30', dayOfWeek: 1 } // 周一

  it('daily 08:30 命中', () => {
    expect(shouldFire(baseCfg(), now0830, null)).toBe(true)
  })
  it('未启用不命中', () => {
    expect(shouldFire(baseCfg({ enabled: false }), now0830, null)).toBe(false)
  })
  it('时间不匹配不命中', () => {
    expect(shouldFire(baseCfg({ time: '08:31' }), now0830, null)).toBe(false)
  })
  it('同槽位已发不命中 (防重)', () => {
    expect(shouldFire(baseCfg(), now0830, '2026-03-16')).toBe(false)
  })
  it('昨日槽位不影响今日 (跨日重置)', () => {
    expect(shouldFire(baseCfg(), now0830, '2026-03-15')).toBe(true)
  })
  it('weekly: 星期匹配命中', () => {
    expect(shouldFire(baseCfg({ frequency: 'weekly', dayOfWeek: 1 }), now0830, null)).toBe(true)
  })
  it('weekly: 星期不匹配不命中 (dayOfWeek 边界 0 周日)', () => {
    expect(shouldFire(baseCfg({ frequency: 'weekly', dayOfWeek: 0 }), now0830, null)).toBe(false)
  })
  it('weekly: dayOfWeek=6 周六', () => {
    const sat = { date: '2026-03-21', time: '20:00', dayOfWeek: 6 }
    expect(shouldFire(baseCfg({ frequency: 'weekly', dayOfWeek: 6, time: '20:00' }), sat, null)).toBe(true)
    expect(shouldFire(baseCfg({ frequency: 'weekly', dayOfWeek: 6, time: '20:00' }), sat, '2026-03-21')).toBe(false)
  })
  it('边界: 00:00 触发', () => {
    const midnight = { date: '2026-03-16', time: '00:00', dayOfWeek: 1 }
    expect(shouldFire(baseCfg({ time: '00:00' }), midnight, null)).toBe(true)
  })
  it('边界: 23:59 触发', () => {
    const late = { date: '2026-03-16', time: '23:59', dayOfWeek: 1 }
    expect(shouldFire(baseCfg({ time: '23:59' }), late, null)).toBe(true)
  })
})

describe('weekOfMonthOf', () => {
  it('1日 → 1', () => expect(weekOfMonthOf('2026-03-01')).toBe(1))
  it('7日 → 1', () => expect(weekOfMonthOf('2026-03-07')).toBe(1))
  it('8日 → 2', () => expect(weekOfMonthOf('2026-03-08')).toBe(2))
  it('14日 → 2', () => expect(weekOfMonthOf('2026-03-14')).toBe(2))
  it('15日 → 3', () => expect(weekOfMonthOf('2026-03-15')).toBe(3))
  it('21日 → 3', () => expect(weekOfMonthOf('2026-03-21')).toBe(3))
  it('22日 → 4', () => expect(weekOfMonthOf('2026-03-22')).toBe(4))
  it('31日 → 4 (cap)', () => expect(weekOfMonthOf('2026-03-31')).toBe(4))
})

// ---------------------------------------------------------------- 数据与建议

describe('ma250Of', () => {
  it('不足 250 条 → null', () => {
    expect(ma250Of(Array.from({ length: 249 }, () => 1))).toBeNull()
  })
  it('恰好 250 条 → 均值', () => {
    expect(ma250Of(Array.from({ length: 250 }, () => 2))).toBe(2)
  })
  it('超过 250 条 → 取最近 250', () => {
    const closes = [...Array.from({ length: 300 }, () => 1), ...Array.from({ length: 250 }, () => 3)]
    expect(ma250Of(closes)).toBe(3)
  })
  it('空数组 → null', () => {
    expect(ma250Of([])).toBeNull()
  })
})

describe('buildSuggestions', () => {
  const date = '2026-03-16' // 第 3 周 (16日)
  const mkLoad = (closes: number[]) => async (_: string): Promise<IndexCloseRow[]> =>
    closes.map((close, i) => ({ date: `2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, close }))

  const cfg = (over: Partial<DcaConfigLike['data']> = {}): DcaConfigLike => ({
    id: 'c1',
    data: { name: '测试配置', symbol: '^NDX', weeklySplits: [100, 200, 300, 400], ...over }
  })

  it('正常: 第 3 周 split=300, 基准档 rate=1 → 300', async () => {
    const closes = Array.from({ length: 250 }, () => 100)
    const out = await buildSuggestions([cfg()], mkLoad(closes), date)
    expect(out[0].suggestedAmount).toBe(300)
    expect(out[0].bucketLabel).toBe('基准')
    expect(out[0].unavailable).toBeUndefined()
  })

  it('低位深跌: close 远低于 ma → 2.8 倍取整', async () => {
    const closes = [...Array.from({ length: 250 }, () => 100), 50]
    const out = await buildSuggestions([cfg()], mkLoad(closes), date)
    expect(out[0].bucketLabel).toBe('低位 40%以上')
    expect(out[0].suggestedAmount).toBe(840)
  })

  it('高位: close 高于 ma 60% → 0.1 倍', async () => {
    const closes = [...Array.from({ length: 250 }, () => 100), 160]
    const out = await buildSuggestions([cfg()], mkLoad(closes), date)
    expect(out[0].bucketLabel).toBe('高位 50-100%')
    expect(out[0].suggestedAmount).toBe(30)
  })

  it('金额取整: split 333.7 → currentSplit round 后建议为整数', async () => {
    const closes = [...Array.from({ length: 250 }, () => 100), 103]
    const c = cfg({ weeklySplits: [100, 200, 333.7, 400] })
    const out = await buildSuggestions([c], mkLoad(closes), date)
    expect(Number.isInteger(out[0].suggestedAmount)).toBe(true)
    expect(out[0].suggestedAmount).toBe(234) // round(334*0.7)
  })

  it('数据缺失: 空数组 → unavailable 标注, 不抛', async () => {
    const out = await buildSuggestions([cfg()], mkLoad([]), date)
    expect(out[0].unavailable).toContain('历史数据不足')
    expect(out[0].suggestedAmount).toBe(0)
  })

  it('数据不足 250 → unavailable', async () => {
    const out = await buildSuggestions([cfg()], mkLoad(Array.from({ length: 100 }, () => 100)), date)
    expect(out[0].unavailable).toContain('250')
  })

  it('loader 抛错 → unavailable (降级不中断)', async () => {
    const out = await buildSuggestions([cfg()], async () => { throw new Error('db down') }, date)
    expect(out[0].unavailable).toContain('历史数据不足')
  })

  it('配置缺 weeklySplits → unavailable', async () => {
    const out = await buildSuggestions([cfg({ weeklySplits: undefined })], mkLoad(Array.from({ length: 250 }, () => 100)), date)
    expect(out[0].unavailable).toContain('weeklySplits')
  })

  it('配置缺 symbol → unavailable', async () => {
    const out = await buildSuggestions([cfg({ symbol: undefined })], mkLoad(Array.from({ length: 250 }, () => 100)), date)
    expect(out[0].unavailable).toContain('目标标的')
  })

  it('无配置 → 空数组', async () => {
    const out = await buildSuggestions([], mkLoad([]), date)
    expect(out).toEqual([])
  })

  it('多配置: 部分可用部分缺失, 互不影响', async () => {
    const good = cfg()
    const bad = { id: 'c2', data: { name: '坏配置', symbol: '^BAD', weeklySplits: [1, 1, 1, 1] } }
    const out = await buildSuggestions([good, bad], async (sym) => sym === '^NDX' ? Array.from({ length: 251 }, (_, i) => ({ date: String(i), close: i === 250 ? 100 : 100 })) : [], date)
    expect(out[0].unavailable).toBeUndefined()
    expect(out[1].unavailable).toBeTruthy()
  })
})

// ---------------------------------------------------------------- 通道 (正弦波数据, 保证有真实枢轴)

/** 生成正弦波形月K: base + amp*sin — 保证周期性高低点 */
function waveBars(n: number, base = 3000, amp = 800, period = 24): { date: string; open: number; close: number; high: number; low: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const mid = base + amp * Math.sin((i / period) * Math.PI * 2)
    const y = 2000 + Math.floor(i / 12)
    const m = String(1 + (i % 12)).padStart(2, '0')
    const high = mid + 300
    const low = mid - 300
    return { date: `${y}-${m}-01`, open: mid, close: Math.round(mid), high: Math.round(high), low: Math.round(low) }
  })
}

describe('parsePush2hisKline', () => {
  it('正常解析并升序', () => {
    const bars = parsePush2hisKline({ data: { klines: ['2026-02-01,3000,3100,3200,2900', '2026-01-01,2900,3000,3050,2800'] } })
    expect(bars).toHaveLength(2)
    expect(bars[0].date).toBe('2026-01-01')
    expect(bars[0].close).toBe(3000)
  })
  it('非法行跳过', () => {
    const bars = parsePush2hisKline({ data: { klines: ['bad', '2026-01-01,x,y,z,w', '2026-02-01,3000,3100,3200,2900'] } })
    expect(bars).toHaveLength(1)
  })
  it('klines 缺失 → []', () => {
    expect(parsePush2hisKline({})).toEqual([])
    expect(parsePush2hisKline(null)).toEqual([])
    expect(parsePush2hisKline({ data: {} })).toEqual([])
  })
  it('价格非正数跳过', () => {
    const bars = parsePush2hisKline({ data: { klines: ['2026-01-01,0,3000,3200,-5', '2026-02-01,3000,3100,3200,2900'] } })
    expect(bars).toHaveLength(1)
  })
})

describe('findPivots / theilSenSlope', () => {
  it('theilSenSlope: <2 点 → 0', () => {
    expect(theilSenSlope([])).toBe(0)
    expect(theilSenSlope([{ t: 0, value: 1 }])).toBe(0)
  })
  it('theilSenSlope: 完美直线斜率', () => {
    expect(theilSenSlope([{ t: 0, value: 0 }, { t: 1, value: 10 }, { t: 2, value: 20 }])).toBe(10)
  })
  it('findPivots: 波动序列找出高低点', () => {
    const bars = waveBars(80)
    const { highs, lows } = findPivots(bars, 6)
    expect(highs.length).toBeGreaterThan(0)
    expect(lows.length).toBeGreaterThan(0)
  })
  it('findPivots: 枢轴值确实是局部极值', () => {
    const bars = waveBars(80)
    const { highs } = findPivots(bars, 6)
    for (const h of highs) {
      // 枢轴高点半径 6 内无更高者
      for (let j = Math.max(0, h.t - 6); j <= Math.min(bars.length - 1, h.t + 6); j++) {
        expect(bars[j].high).toBeLessThanOrEqual(h.value)
      }
    }
  })
})

describe('fitChannel / zoneOf', () => {
  const bars = waveBars(120, 3000, 800, 18)
  const channel = fitChannel(bars)
  const tNow = bars.length - 1

  it('fitChannel: 顶线高于底线', () => {
    const topAt = channel.top.slope * tNow + channel.top.intercept
    const bottomAt = channel.bottom.slope * tNow + channel.bottom.intercept
    expect(topAt).toBeGreaterThan(bottomAt)
  })
  it('fitChannel: 低线是下包络 (各低点枢轴在线上或上方)', () => {
    for (const p of channel.pivotLows) {
      const lineVal = channel.bottom.slope * p.t + channel.bottom.intercept
      expect(p.value).toBeGreaterThanOrEqual(lineVal - 1)
    }
  })
  it('fitChannel: 顶线是上包络 (候选高点在线上或下方)', () => {
    for (const p of channel.pivotHighs) {
      const lineVal = channel.top.slope * p.t + channel.top.intercept
      expect(p.value).toBeLessThanOrEqual(lineVal + 1)
    }
  })
  it('zoneOf: 底线下方 → strong-buy, posPct 0', () => {
    const bottomAt = channel.bottom.slope * tNow + channel.bottom.intercept
    const info = zoneOf(bottomAt - 1, channel, tNow)
    expect(info.zone).toBe('strong-buy')
    expect(info.posPct).toBe(0)
  })
  it('zoneOf: 中线下方 → buy', () => {
    const bottomAt = channel.bottom.slope * tNow + channel.bottom.intercept
    const topAt = channel.top.slope * tNow + channel.top.intercept
    const info = zoneOf((bottomAt + topAt) / 2 - 1, channel, tNow)
    expect(info.zone).toBe('buy')
  })
  it('zoneOf: 中线上方 → sell', () => {
    const bottomAt = channel.bottom.slope * tNow + channel.bottom.intercept
    const topAt = channel.top.slope * tNow + channel.top.intercept
    const info = zoneOf((bottomAt + topAt) / 2 + 1, channel, tNow)
    expect(info.zone).toBe('sell')
  })
  it('zoneOf: 顶线上方 → strong-sell, posPct 100', () => {
    const topAt = channel.top.slope * tNow + channel.top.intercept
    const info = zoneOf(topAt + 1, channel, tNow)
    expect(info.zone).toBe('strong-sell')
    expect(info.posPct).toBe(100)
  })
  it('zoneOf: mid = (top+bottom)/2', () => {
    const info = zoneOf(3000, channel, tNow)
    expect(info.mid).toBe((info.top + info.bottom) / 2)
  })
  it('低置信: 数据 < 60 月', () => {
    const ch = fitChannel(waveBars(30))
    expect(ch.lowConfidence).toBe(true)
  })
  it('置信: 120 月正弦波不低于置信 (枢轴充足)', () => {
    expect(channel.lowConfidence).toBe(false)
  })
  it('避雷针剔除: 尖峰高点被排除 (≤2)', () => {
    const spiked = waveBars(120).map((b, i) =>
      i === 60 ? { ...b, high: 99000 } : i === 90 ? { ...b, high: 98000 } : b)
    const ch = fitChannel(spiked)
    expect(ch.excludedSpikes.length).toBeGreaterThan(0)
    expect(ch.excludedSpikes.length).toBeLessThanOrEqual(2)
  })
})

describe('buildChannelSummary', () => {
  const bars = waveBars(120)
  const channel = fitChannel(bars)
  const tNow = bars.length - 1
  const bottomAt = channel.bottom.slope * tNow + channel.bottom.intercept

  it('正常构建: 含 mid/posPct/zone', () => {
    const s = buildChannelSummary(bars, null)
    expect(s).not.toBeNull()
    expect(s!.mid).toBeGreaterThan(s!.bottom)
    expect(s!.posPct).toBeGreaterThanOrEqual(0)
    expect(s!.posPct).toBeLessThanOrEqual(100)
    expect(['strong-buy', 'buy', 'sell', 'strong-sell']).toContain(s!.zone)
  })
  it('数据不足 → null', () => {
    expect(buildChannelSummary(bars.slice(0, 5), null)).toBeNull()
  })
  it('close 覆盖: 底线值 → posPct 0, strong-buy', () => {
    const s = buildChannelSummary(bars, Math.round(bottomAt) - 1)
    expect(s!.close).toBe(Math.round(bottomAt) - 1)
    expect(s!.posPct).toBe(0)
    expect(s!.zone).toBe('strong-buy')
  })
  it('close 覆盖: 顶线值 → posPct 100, strong-sell', () => {
    const topAt = channel.top.slope * tNow + channel.top.intercept
    const s = buildChannelSummary(bars, Math.round(topAt) + 1)
    expect(s!.posPct).toBe(100)
    expect(s!.zone).toBe('strong-sell')
  })
  it('close=null → 用月K最后收盘', () => {
    const s = buildChannelSummary(bars, null)!
    expect(s.close).toBe(bars[tNow].close)
  })
  it('数值四舍五入 (2 位/1 位)', () => {
    const s = buildChannelSummary(bars, null)!
    expect(s.mid * 100).toBe(Math.round(s.mid * 100))
    expect(s.posPct * 10).toBe(Math.round(s.posPct * 10))
  })
})

// ---------------------------------------------------------------- 邮件渲染

describe('renderMail', () => {
  const bars = waveBars(120)
  const channel = buildChannelSummary(bars, null)!
  const sug = {
    configId: 'c1', name: '纳指定投', target: '^NDX', weekIndex: 2 as const,
    currentSplit: 300, bucketLabel: '基准', suggestedAmount: 300
  }

  it('正常: subject 含日期与策略, text/html 含建议金额与三线', () => {
    const m = renderMail({ dateISO: '2026-03-16', suggestions: [sug], channel })
    expect(m.subject).toContain('2026-03-16')
    expect(m.text).toContain('300')
    expect(m.text).toContain('中线')
    expect(m.text).toContain('今日策略')
    expect(m.html).toContain('纳指定投')
    expect(m.html).toContain('%')
  })
  it('无定投配置 → 提示暂无, 通道部分仍渲染', () => {
    const m = renderMail({ dateISO: '2026-03-16', suggestions: [], channel })
    expect(m.text).toContain('暂无定投配置')
    expect(m.text).toContain('上证指数通道')
  })
  it('建议不可用 → 数据不可用标注', () => {
    const bad = { ...sug, unavailable: '历史数据不足', bucketLabel: '', suggestedAmount: 0 }
    const m = renderMail({ dateISO: '2026-03-16', suggestions: [bad], channel })
    expect(m.text).toContain('数据不可用')
    expect(m.html).toContain('数据不可用')
  })
  it('通道 null → 数据不可用标注, 邮件仍完整', () => {
    const m = renderMail({ dateISO: '2026-03-16', suggestions: [sug], channel: null, channelError: '月K抓取失败' })
    expect(m.text).toContain('数据不可用')
    expect(m.text).toContain('月K抓取失败')
    expect(m.subject).toContain('数据不可用')
  })
  it('双降级: 无配置 + 通道 null', () => {
    const m = renderMail({ dateISO: '2026-03-16', suggestions: [], channel: null })
    expect(m.text).toContain('暂无定投配置')
    expect(m.text).toContain('数据不可用')
  })
})
