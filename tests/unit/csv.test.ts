import { describe, it, expect } from 'vitest'
import { csvEscape, toCsv, fromCsv } from '@/lib/csv'

describe('csv', () => {
  it('csvEscape plain', () => {
    expect(csvEscape('abc')).toBe('abc')
    expect(csvEscape(123)).toBe('123')
  })
  it('csvEscape null/undefined', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
  })
  it('csvEscape with comma', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })
  it('csvEscape with quote', () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""')
  })
  it('csvEscape with newline', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"')
  })
  it('toCsv + fromCsv roundtrip', () => {
    const csv = toCsv(['id', 'name'], [
      [1, 'foo'],
      [2, 'bar,baz'],
      [3, 'he said "ok"'],
      [4, 'line1\nline2']
    ])
    const rows = fromCsv(csv)
    expect(rows[0]).toEqual(['id', 'name'])
    expect(rows[1]).toEqual(['1', 'foo'])
    expect(rows[2]).toEqual(['2', 'bar,baz'])
    expect(rows[3]).toEqual(['3', 'he said "ok"'])
    expect(rows[4]).toEqual(['4', 'line1\nline2'])
  })
})
