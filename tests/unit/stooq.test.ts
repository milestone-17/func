import { describe, it, expect } from 'vitest'
import { buildStooqUrl, parseStooqCsv } from '@/lib/stooq'

describe('stooq', () => {
  it('buildStooqUrl formats correctly', () => {
    expect(buildStooqUrl('QQQ.US', '2024-01-01', '2024-12-31'))
      .toBe('https://stooq.com/q/d/l/?s=qqq.us&i=d&d1=20240101&d2=20241231')
  })

  it('parseStooqCsv parses simple response', () => {
    const csv = `Date,Open,High,Low,Close,Volume
2024-01-02,400,410,395,408,1000000
2024-01-03,408,415,407,412,900000`
    const bars = parseStooqCsv(csv)
    expect(bars.length).toBe(2)
    expect(bars[0].close).toBe(408)
    expect(bars[1].date).toBe('2024-01-03')
  })

  it('parseStooqCsv throws on bad header', () => {
    expect(() => parseStooqCsv('foo,bar\n1,2')).toThrow()
  })

  it('parseStooqCsv returns empty on no data', () => {
    expect(parseStooqCsv('Date,Open,High,Low,Close,Volume\n')).toEqual([])
  })

  it('parseStooqCsv skips malformed rows', () => {
    const csv = `Date,Open,High,Low,Close,Volume
2024-01-02,400,410,395,408,1000000
bad-row
2024-01-03,408,415,407,412,900000`
    const bars = parseStooqCsv(csv)
    expect(bars.length).toBe(2)
  })
})
