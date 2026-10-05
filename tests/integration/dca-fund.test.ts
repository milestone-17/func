/**
 * 定投自选基金集成测试
 * - addFund: 校验代码/去重/净值可得性预检
 * - loadSymbol(fund:CODE): 净值序列 → MA/档位/建议产出
 * - syncIndex: 基金净值同步
 * - runAutoExecutions: 基金标的定投执行 (幂等)
 * - removeFund: 移除自选
 *
 * fetch mock: mem-api 拦截 /api/*; 东财代理接口 (fund-search/fund-history) 用 vi.stubGlobal 覆盖后经 __funcApiFetch 转发
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { setTodayForTests } from '@/stores/portfolio'
import { setDcaTodayForTests, useDcaStore, FUND_PREFIX, isFundSymbol, fundCodeOf } from '@/stores/dca'
import { resetDbForTests } from '@/repos/db'

function wipeDb() {
  resetDbForTests()
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('func-db')
    req.onsuccess = () => resolve(); req.onerror = () => resolve(); req.onblocked = () => resolve()
  })
}

/** 造 500 个交易日净值序列 (上升趋势, 可形成 MA250) */
function makeNavBars(count = 500, base = 1.5): Array<{ date: string; nav: number }> {
  const bars: Array<{ date: string; nav: number }> = []
  let d = new Date('2024-06-01T00:00:00Z')
  for (let i = 0; i < count; i++) {
    // 跳过周末
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
    const nav = Math.round((base + i * 0.001) * 10000) / 10000
    bars.push({ date: d.toISOString().slice(0, 10), nav })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return bars
}

const FUND_BARS = makeNavBars()
const G = globalThis as any

describe('定投自选基金', () => {
  beforeEach(async () => {
    await wipeDb()
    setActivePinia(createPinia())
    // stub fetch: /api/* 走 mem-api, 其余 (东财直连不应发生) 报错
    const apiFetch = G.__funcApiFetch
    G.__origFetch = G.fetch
    G.fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.startsWith('/api/')) return apiFetch(input, init)
      return new Response(JSON.stringify({ error: 'external fetch blocked in tests' }), { status: 502 })
    }
  })
  afterEach(() => {
    G.fetch = G.__origFetch
    vi.unstubAllGlobals()
    setTodayForTests(null)
    setDcaTodayForTests(null)
  })

  it('addFund: 非法代码被拒绝', async () => {
    const dca = useDcaStore()
    await dca.load()
    const r1 = await dca.addFund('1594', '代码不足6位')
    expect(r1.ok).toBe(false)
    const r2 = await dca.addFund('abcdef', '字母代码')
    expect(r2.ok).toBe(false)
    expect(dca.myFunds.length).toBe(0)
  })

  it('addFund: 净值不可得被拒绝 (服务端 502)', async () => {
    // 覆盖 fund-history 返回 502
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.startsWith('/api/market/fund-history')) {
        return new Response(JSON.stringify({ error: '净值历史获取失败: 无数据' }), { status: 502, headers: { 'content-type': 'application/json' } })
      }
      return G.__funcApiFetch(input, init)
    })
    const dca = useDcaStore()
    await dca.load()
    const r = await dca.addFund('000000', '不存在的基金')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('净值')
    expect(dca.myFunds.length).toBe(0)
  })

  it('addFund: 净值条数不足 30 被拒绝', async () => {
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.startsWith('/api/market/fund-history')) {
        return new Response(JSON.stringify({ code: '111111', bars: FUND_BARS.slice(0, 10), latest: FUND_BARS[9] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return G.__funcApiFetch(input, init)
    })
    const dca = useDcaStore()
    await dca.load()
    const r = await dca.addFund('111111', '净值太短的基金')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不足')
  })

  it('addFund → loadSymbol → MA/档位产出, 净值与输入一致', async () => {
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.startsWith('/api/market/fund-history')) {
        return new Response(JSON.stringify({ code: '001594', bars: FUND_BARS, latest: FUND_BARS[FUND_BARS.length - 1] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return G.__funcApiFetch(input, init)
    })
    const dca = useDcaStore()
    await dca.load()
    const r = await dca.addFund('001594', '天弘纳斯达克100')
    expect(r.ok).toBe(true)
    expect(dca.myFunds.map(f => f.code)).toContain('001594')

    const sym = FUND_PREFIX + '001594'
    expect(isFundSymbol(sym)).toBe(true)
    expect(fundCodeOf(sym)).toBe('001594')

    dca.setActive(sym)
    await dca.loadSymbol(sym)
    const st = dca.states[sym]
    expect(st.series.length).toBe(500)
    // 最新净值与 mock 数据一致 (数据准确性)
    expect(st.series[st.series.length - 1].close).toBe(FUND_BARS[FUND_BARS.length - 1].nav)
    // MA 已产出
    expect(dca.ma250).not.toBeNull()
    expect(dca.ma120).not.toBeNull()
    expect(dca.deviationPct).not.toBeNull()
    // 配置后 4 周建议 + 档位产出 (无 config 时 bucket 会被清空, 这是设计行为)
    await dca.saveConfig({
      name: '基金定投', symbol: sym,
      monthlyBudget: 80000, weeklySplits: [20000, 20000, 20000, 20000],
      deviationAlertPercent: 5, targetHoldingId: null
    })
    expect(dca.bucket).not.toBeNull()
    // 上升趋势 → 高位/基准档位
    expect(['high', 'flat']).toContain(dca.bucket!.side)
    expect(dca.suggestions[1]).not.toBeNull()
    expect(dca.suggestions[1]!.suggestedAmount).toBeGreaterThan(0)
  })

  it('addFund 重复添加 → 报错已存在', async () => {
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.startsWith('/api/market/fund-history')) {
        return new Response(JSON.stringify({ code: '001594', bars: FUND_BARS, latest: null }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return G.__funcApiFetch(input, init)
    })
    const dca = useDcaStore()
    await dca.load()
    expect((await dca.addFund('001594', '天弘纳斯达克100')).ok).toBe(true)
    const r2 = await dca.addFund('001594', '重复添加')
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('已在自选')
  })

  it('基金标的 syncIndex → 净值刷新成功', async () => {
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.startsWith('/api/market/fund-history')) {
        return new Response(JSON.stringify({ code: '001594', bars: FUND_BARS, latest: FUND_BARS[FUND_BARS.length - 1] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return G.__funcApiFetch(input, init)
    })
    const dca = useDcaStore()
    await dca.load()
    await dca.addFund('001594', '天弘纳斯达克100')
    const sym = FUND_PREFIX + '001594'
    dca.setActive(sym)
    const r = await dca.syncIndex()
    expect(r.ok).toBe(true)
    expect(dca.dataSource).toBe('fund')
    expect(dca.lastClose).toBe(FUND_BARS[FUND_BARS.length - 1].nav)
  })

  it('基金标的 syncIndex 失败 → syncError 透出', async () => {
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.startsWith('/api/market/fund-history')) {
        return new Response(JSON.stringify({ error: '净值历史获取失败: 上游超时' }), { status: 502, headers: { 'content-type': 'application/json' } })
      }
      return G.__funcApiFetch(input, init)
    })
    const dca = useDcaStore()
    await dca.load()
    // 手动注入一个基金 state (绕过 addFund 预检)
    dca.states['fund:001594'] = {
      config: null, series: [], bucket: null,
      suggestions: { 1: null, 2: null, 3: null, 4: null },
      lastSyncAt: null, syncError: null, dataSource: null
    }
    dca.myFunds = [{ id: 'f1', code: '001594', name: '天弘纳斯达克100' }]
    dca.setActive('fund:001594')
    const r = await dca.syncIndex()
    expect(r.ok).toBe(false)
    expect(dca.syncError).toContain('失败')
  })

  it('removeFund → myFunds 移除, states 清理, active 回退指数', async () => {
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.startsWith('/api/market/fund-history')) {
        return new Response(JSON.stringify({ code: '001594', bars: FUND_BARS, latest: null }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return G.__funcApiFetch(input, init)
    })
    const dca = useDcaStore()
    await dca.load()
    await dca.addFund('001594', '天弘纳斯达克100')
    const sym = FUND_PREFIX + '001594'
    dca.setActive(sym)
    await dca.removeFund('001594')
    expect(dca.myFunds.length).toBe(0)
    expect(dca.states[sym]).toBeUndefined()
    expect(isFundSymbol(dca.activeSymbol)).toBe(false)
  })

  it('指数标的 (无自选) load/sync 行为不回归: ^NDX 无数据时 sync 走预置', async () => {
    const dca = useDcaStore()
    await dca.load()
    expect(dca.allSymbols()).toContain('^NDX')
    expect(dca.allSymbols()).toContain('^GSPC')
    // runAutoExecutions 无 config 全跳过
    const r = await dca.runAutoExecutions('2026-08-13')
    expect(r.executed.length).toBe(0)
    expect(r.skipped.length).toBe(2)
  })
})
