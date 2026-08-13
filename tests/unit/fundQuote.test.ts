import { describe, it, expect, vi } from 'vitest'
import { parseFundGz, fetchFundQuote } from '@/lib/fundQuote'

describe('parseFundGz', () => {
  it('优先真实单位净值 dwjz', () => {
    const r = parseFundGz({ fundcode: '006260', name: '红利增长', dwjz: '1.2345', gsz: '1.24', jzrq: '2026-08-12', gztime: '2026-08-13 15:00' })
    expect(r).not.toBeNull()
    expect(r!.nav).toBe(1.2345)
    expect(r!.isEstimate).toBe(false)
    expect(r!.code).toBe('006260')
    expect(r!.navDate).toBe('2026-08-12')
  })
  it('无 dwjz 时回退估算值 gsz, 标记为估算', () => {
    const r = parseFundGz({ fundcode: '006260', name: '红利增长', gsz: '1.24', gszzl: '0.8', gztime: '2026-08-13 15:00' })
    expect(r!.nav).toBe(1.24)
    expect(r!.isEstimate).toBe(true)
    expect(r!.navDate).toBe('2026-08-13 15:00')
  })
  it('两者都无效 → null', () => {
    expect(parseFundGz({ fundcode: '006260', dwjz: '', gsz: '' })).toBeNull()
    expect(parseFundGz({ fundcode: '006260', dwjz: '0', gsz: '-1' })).toBeNull()
    expect(parseFundGz({ fundcode: '006260' })).toBeNull()
  })
  it('非对象 → null', () => {
    expect(parseFundGz(null)).toBeNull()
    expect(parseFundGz('jsonpgz({...})')).toBeNull()
    expect(parseFundGz(undefined)).toBeNull()
  })
})

describe('fetchFundQuote', () => {
  it('超时返回 null, 不抛出', async () => {
    // 用桩 script 避免 happy-dom 真正发起网络加载; 验证超时降级逻辑
    const handlers: Record<string, unknown> = {}
    const fakeScript: any = {
      set onerror(fn: any) { handlers.onerror = fn },
      get onerror() { return handlers.onerror },
      set src(_v: string) { /* no-op: 不触发加载 */ },
      get src() { return '' },
      remove() {},
    }
    const ce = vi.spyOn(document, 'createElement').mockReturnValue(fakeScript)
    const ac = vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => node)
    const r = await fetchFundQuote('006260', 150)
    expect(r).toBeNull()
    ce.mockRestore()
    ac.mockRestore()
  })
})
