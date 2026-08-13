import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseFundMNFInfo, parsePingzhongDataTrend, parsePingzhongDataFullTrend,
  fetchFundNavs, fetchFundNavByPingzhongdata, fetchFundQuote
} from '@/lib/fundQuote'

/** 可注入的假 script: 记录 src, 暴露 onload/onerror 供测试触发 */
interface ScriptHandlers { onload?: () => void; onerror?: () => void }
function createFakeScript() {
  const handlers: ScriptHandlers = {}
  const fake: any = {
    set onload(fn: any) { handlers.onload = fn },
    get onload() { return handlers.onload },
    set onerror(fn: any) { handlers.onerror = fn },
    get onerror() { return handlers.onerror },
    set src(v: string) { fake._src = v },
    get src() { return fake._src },
    remove() {},
  }
  return { fake, handlers }
}

function stubScriptInjection() {
  const { fake, handlers } = createFakeScript()
  vi.spyOn(document, 'createElement').mockReturnValue(fake)
  vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => node)
  return { fake, handlers }
}

afterEach(() => {
  vi.restoreAllMocks()
})

const MNF_INFO_PAYLOAD = {
  Datas: [
    { FCODE: '006260', SHORTNAME: '汇添富红利增长混合C', PDATE: '2026-08-12', NAV: '1.7811', GSZ: null },
    { FCODE: '019261', SHORTNAME: '富国恒生红利ETF联接C', PDATE: '2026-08-12', NAV: '1.2267', GSZ: null },
    { FCODE: '270042', SHORTNAME: '广发纳斯达克100ETF联接人民币(QDII)A', PDATE: '2026-08-11', NAV: '8.1894', GSZ: null },
  ]
}

describe('parseFundMNFInfo', () => {
  it('NAV+PDATE → 真实净值, isEstimate=false', () => {
    const m = parseFundMNFInfo(MNF_INFO_PAYLOAD)
    expect(m.size).toBe(3)
    const a = m.get('006260')!
    expect(a.nav).toBe(1.7811)
    expect(a.isEstimate).toBe(false)
    expect(a.navDate).toBe('2026-08-12')
    expect(a.name).toContain('汇添富')
  })

  it('无 NAV 有 GSZ → 用估值, isEstimate=true', () => {
    const m = parseFundMNFInfo({ Datas: [{ FCODE: '006260', PDATE: '2026-08-12', NAV: null, GSZ: '1.80' }] })
    const a = m.get('006260')!
    expect(a.nav).toBe(1.8)
    expect(a.isEstimate).toBe(true)
  })

  it('NAV 非正/无效 → 丢弃该条, 不影响其他', () => {
    const m = parseFundMNFInfo({
      Datas: [
        { FCODE: '006260', NAV: '0', GSZ: null },
        { FCODE: '019261', NAV: '-1', GSZ: null },
        { FCODE: '270042', NAV: '', GSZ: '8.1' },
        { FCODE: '006479', NAV: '1.2', GSZ: null },
      ]
    })
    expect(m.has('006260')).toBe(false)
    expect(m.has('019261')).toBe(false)
    expect(m.get('270042')!.nav).toBe(8.1)
    expect(m.get('270042')!.isEstimate).toBe(true)
    expect(m.get('006479')!.nav).toBe(1.2)
  })

  it('非 6 位 FCODE 或非对象 → 跳过/空 Map', () => {
    expect(parseFundMNFInfo(null).size).toBe(0)
    expect(parseFundMNFInfo('x').size).toBe(0)
    expect(parseFundMNFInfo({ Datas: [{ FCODE: 'QQQ', NAV: '1', GSZ: null }] }).size).toBe(0)
    expect(parseFundMNFInfo({ Datas: 'not-array' }).size).toBe(0)
  })
})

describe('parsePingzhongDataTrend', () => {
  it('取末个有效 y', () => {
    expect(parsePingzhongDataTrend([{ x: 1, y: 1.5 }, { x: 2, y: 1.6 }, { x: 3, y: null }])).toBe(1.6)
  })
  it('末位无效回退前一位', () => {
    expect(parsePingzhongDataTrend([{ x: 1, y: 1.5 }, { x: 2, y: 0 }])).toBe(1.5)
  })
  it('空/非数组/全无效 → null', () => {
    expect(parsePingzhongDataTrend([])).toBeNull()
    expect(parsePingzhongDataTrend(null)).toBeNull()
    expect(parsePingzhongDataTrend([{ x: 1, y: -1 }])).toBeNull()
  })
})

describe('fetchFundNavs', () => {
  it('回调返回数据 → 解析出 Map', async () => {
    const { fake } = stubScriptInjection()
    const p = fetchFundNavs(['006260', '019261'])
    const cb = /callback=([^&]+)/.exec(fake.src)![1]
    ;(window as any)[cb](MNF_INFO_PAYLOAD)
    const m = await p
    expect(m.get('006260')!.nav).toBe(1.7811)
    expect(m.get('019261')!.nav).toBe(1.2267)
    expect(fake.src).toContain('Fcodes=006260,019261')
    expect(fake.src).toContain('fundmobapi.eastmoney.com')
  })

  it('超时 → 空 Map, 不抛', async () => {
    stubScriptInjection()
    const m = await fetchFundNavs(['006260'], 30)
    expect(m.size).toBe(0)
  })

  it('空代码列表 → 空 Map', async () => {
    const m = await fetchFundNavs([])
    expect(m.size).toBe(0)
  })
})

describe('fetchFundNavByPingzhongdata', () => {
  it('脚本加载成功 + 全局趋势 → 最近净值', async () => {
    const { handlers } = stubScriptInjection()
    ;(window as any).Data_netWorthTrend = [{ x: 1, y: 1.78 }, { x: 2, y: 1.7811 }]
    const p = fetchFundNavByPingzhongdata('006260', 2000)
    handlers.onload?.()
    const nav = await p
    expect(nav?.nav).toBe(1.7811)
    expect(nav?.isEstimate).toBe(false)
    delete (window as any).Data_netWorthTrend
  })

  it('脚本 onerror → null', async () => {
    const { handlers } = stubScriptInjection()
    const p = fetchFundNavByPingzhongdata('006260', 2000)
    handlers.onerror?.()
    expect(await p).toBeNull()
  })

  it('加载成功但无趋势数据 → null', async () => {
    const { handlers } = stubScriptInjection()
    const p = fetchFundNavByPingzhongdata('006260', 2000)
    handlers.onload?.()
    expect(await p).toBeNull()
  })
})

describe('fetchFundQuote (单只)', () => {
  it('复用批量接口, 取单只', async () => {
    const { fake } = stubScriptInjection()
    const p = fetchFundQuote('006260')
    const cb = /callback=([^&]+)/.exec(fake.src)![1]
    ;(window as any)[cb](MNF_INFO_PAYLOAD)
    const nav = await p
    expect(nav?.nav).toBe(1.7811)
    expect(nav?.source).toBe('fundMNFInfo')
  })
})

describe('parsePingzhongDataFullTrend 完整历史解析', () => {
  it('正常多日数据 → 按时间倒序不重要, 都返回 date+nav', () => {
    const v = [
      { x: Date.UTC(2026, 7, 5), y: 1.78 },
      { x: Date.UTC(2026, 7, 6), y: 1.79 },
      { x: Date.UTC(2026, 7, 7), y: 1.80 }
    ]
    const r = parsePingzhongDataFullTrend(v)
    expect(r).toHaveLength(3)
    expect(r[0].date).toBe('2026-08-05')
    expect(r[2].nav).toBe(1.80)
  })

  it('无效项跳过 (y<=0, 非数, x 非法)', () => {
    const v = [
      { x: Date.UTC(2026, 7, 1), y: 1.5 },
      { x: 'not-a-ts' as unknown as number, y: 1.6 },
      { x: Date.UTC(2026, 7, 2), y: 0 },
      { x: Date.UTC(2026, 7, 3), y: 1.7 }
    ]
    const r = parsePingzhongDataFullTrend(v)
    expect(r).toHaveLength(2)
    expect(r[1].nav).toBe(1.7)
  })

  it('空/非数组 → 空数组', () => {
    expect(parsePingzhongDataFullTrend(null)).toEqual([])
    expect(parsePingzhongDataFullTrend([])).toEqual([])
    expect(parsePingzhongDataFullTrend({})).toEqual([])
  })
})
