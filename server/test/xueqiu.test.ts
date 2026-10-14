import { describe, it, expect } from 'vitest'
import { parseXqQuote, parseXqKline, parseCookieJar, xqSymbolOf } from '../src/lib/xueqiu'

describe('xueqiu source', () => {
  it('xqSymbolOf: 沪/深/美股/指数映射', () => {
    expect(xqSymbolOf('510300')).toBe('SH510300') // 5 开头 → 沪
    expect(xqSymbolOf('600519')).toBe('SH600519') // 6 开头 → 沪
    expect(xqSymbolOf('000001')).toBe('SZ000001') // 0 开头 → 深
    expect(xqSymbolOf('159915')).toBe('SZ159915') // 1 开头 → 深
    expect(xqSymbolOf('QQQ')).toBe('QQQ')
    expect(xqSymbolOf('.NDX')).toBe('.NDX')
  })

  it('parseXqQuote: 正常解析 + 非法输入拒绝', () => {
    const ok = parseXqQuote({ data: { quote: { name: '沪深300ETF', current: 4.432, current_ext: 4.43 } } }, '510300')
    expect(ok).toEqual({ code: '510300', name: '沪深300ETF', price: 4.432, source: 'xueqiu', time: expect.any(Number) })
    // current 缺失时用 current_ext
    const ext = parseXqQuote({ data: { quote: { name: 'X', current_ext: 760.5 } } }, 'QQQ')
    expect(ext?.price).toBe(760.5)
    // 非法: 无 quote / 价格非正 / 无名
    expect(parseXqQuote({}, '510300')).toBeNull()
    expect(parseXqQuote({ data: { quote: { name: 'X', current: 0 } } }, '510300')).toBeNull()
    expect(parseXqQuote({ data: { quote: { current: 5 } } }, '510300')).toBeNull()
  })

  it('parseXqKline: 列式转 bars, 时间戳→UTC 日期, 非法行跳过', () => {
    const json = {
      data: {
        column: ['timestamp', 'volume', 'open', 'high', 'low', 'close'],
        // 行主序: 每行一根K线 (与雪球真实回包一致)
        item: [
          [1784649600000, 100, 4.75, 4.82, 4.75, 4.765],
          [1784736000000, 200, 4.77, 4.79, 4.75, 4.787],
          [null, 0, 0, 0, 0, 0], // 非法行跳过
          [1784822400000, 300, 4.75, 4.76, 4.7, 4.75]
        ]
      }
    }
    const bars = parseXqKline(json)
    expect(bars).toHaveLength(3)
    expect(bars[0]).toEqual({ date: '2026-07-21', close: 4.76 }) // 4.765*100 浮点为 476.49... round→476
    expect(bars[2].close).toBe(4.75)
    // 升序
    expect(bars[0].date < bars[1].date).toBe(true)
  })

  it('parseXqKline: 结构异常返回空数组', () => {
    expect(parseXqKline(null)).toEqual([])
    expect(parseXqKline({})).toEqual([])
    expect(parseXqKline({ data: { column: ['x'], item: [[1]] } })).toEqual([])
    expect(parseXqKline({ data: { column: ['timestamp', 'close'], item: 'bad' } })).toEqual([])
  })

  it('parseCookieJar: curl jar 提取键值对, 忽略注释与 HttpOnly 前缀行', () => {
    const jar = [
      '# Netscape HTTP Cookie File',
      '#HttpOnly_.xueqiu.com\tTRUE\t/\tTRUE\t1789000000\txq_a_token\tabc123',
      '.xueqiu.com\tTRUE\t/\tTRUE\t1789000000\tu\tuser999',
      '',
      'xueqiu.com\tFALSE\t/\tFALSE\t0\tdevice\tDEV-1'
    ].join('\n')
    expect(parseCookieJar(jar)).toBe('xq_a_token=abc123; u=user999; device=DEV-1')
    expect(parseCookieJar('')).toBe('')
  })
})
