/**
 * BacktestCard 组件单测
 * - 渲染: 产物加载成功后 TL;DR / 口径声明 / 免责声明 / 资金曲线容器
 * - 容错: 产物 fetch 失败显示"回测数据加载失败", 组件不崩溃
 * - 金额换算: 金额类指标严格线性, 百分比类不变
 * - 窗口切换: 零新增网络请求
 * - 自定义费率: 防抖 500ms 调 GET /api/backtest, 预设档不请求
 *
 * fixture 使用真实产物 public/backtest-data.json (8 标的 × 4 费率档 × 3 窗口)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import BacktestCard from '@/components/BacktestCard.vue'

const artifactJson = readFileSync(
  fileURLToPath(new NodeURL('../../public/backtest-data.json', import.meta.url)),
  'utf-8'
)
const artifact = JSON.parse(artifactJson) as {
  targets: Record<string, { fees: Record<string, { windows: Record<string, { metrics: Record<string, number> | null } | null> }> }>
}

function metricsOf(secid: string, fee: string, win: string) {
  const m = artifact.targets[secid].fees[fee].windows[win]!.metrics!
  return m
}

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

const apiMetrics = {
  totalInvested: 60000, endValue: 123456, totalReturnPct: 105.8, xirrPct: 9.99,
  maxDrawdownPct: 12.3, maxDrawdownMonths: 8, annualizedVolPct: 18.2, sharpe: 0.88, winRatePct: 58
}

/** 安装 fetch mock, 返回调用记录; artifactOk=false 时产物请求直接 reject */
function installFetch(opts: { artifactOk?: boolean } = {}) {
  const calls: string[] = []
  const spy = vi.fn(async (input: unknown): Promise<Response> => {
    const url = String(typeof input === 'string' ? input : (input as { url?: string })?.url ?? '')
    calls.push(url)
    // 组件经 import.meta.env.BASE_URL 拼接产物路径 (vite base=/func/ → /func/backtest-data.json)
    if (url.endsWith('/backtest-data.json')) {
      if (opts.artifactOk === false) throw new Error('network down')
      return jsonRes(artifact)
    }
    if (url.startsWith('/api/backtest')) {
      return jsonRes({ code: 0, message: 'ok', data: { name: '测试基金', metrics: apiMetrics } })
    }
    throw new Error('unexpected fetch: ' + url)
  })
  vi.stubGlobal('fetch', spy)
  return { calls, backtestCalls: () => calls.filter(u => u.startsWith('/api/backtest')) }
}

const lineChartStub = { template: '<div data-test="line-chart" />' }

function mountCard() {
  return mount(BacktestCard, {
    props: { strategy: 'a' },
    global: { stubs: { LineChart: lineChartStub } }
  })
}

function clickButton(w: VueWrapper, text: string) {
  const btn = w.findAll('button').find(b => b.text() === text)
  expect(btn, `按钮 "${text}" 应存在`).toBeTruthy()
  return btn!.trigger('click')
}

const fmtYuan = (n: number) => `¥${Math.round(n).toLocaleString('zh-CN')}`

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('BacktestCard', () => {
  it('渲染: 产物加载成功后显示 TL;DR / 口径声明 / 免责声明 / 资金曲线容器', async () => {
    installFetch()
    const w = mountCard()
    await flushPromises()

    expect(w.text()).toContain('15 年策略回测')
    expect(w.text()).toContain('XIRR 年化')
    expect(w.text()).toContain('最大回撤')
    expect(w.text()).toContain('口径与假设')
    expect(w.text()).toContain('历史回测仅供策略研究，不构成投资建议')
    // 资金曲线容器 (策略A + 预置标的 + 默认费率档 + 全区间 → 渲染 LineChart)
    expect(w.find('[data-test="line-chart"]').exists()).toBe(true)
    // 指标网格
    expect(w.text()).toContain('累计投入')
    expect(w.text()).toContain('期末资产')
  })

  it('容错: 产物 fetch 失败显示"回测数据加载失败", 组件不崩溃', async () => {
    installFetch({ artifactOk: false })
    const w = mountCard()
    await flushPromises()

    expect(w.exists()).toBe(true)
    expect(w.text()).toContain('回测数据加载失败')
    // 重试按钮可用, 点击后重新请求不抛异常
    await clickButton(w, '重试')
    await flushPromises()
    expect(w.text()).toContain('回测数据加载失败')
  })

  it('金额换算: 1000 → 2000, 金额类指标严格 ×2, 百分比类指标不变', async () => {
    installFetch()
    const w = mountCard()
    await flushPromises()

    const m = metricsOf('1.000001', '0.0005', 'full')
    expect(w.text()).toContain(fmtYuan(m.totalInvested))
    expect(w.text()).toContain(fmtYuan(m.endValue))
    const retText = `+${m.totalReturnPct.toFixed(1)}%`
    const ddText = `-${m.maxDrawdownPct.toFixed(1)}%`
    expect(w.text()).toContain(retText)
    expect(w.text()).toContain(ddText)

    await clickButton(w, '2000')

    // 金额类严格 ×2
    expect(w.text()).toContain(fmtYuan(m.totalInvested * 2))
    expect(w.text()).toContain(fmtYuan(m.endValue * 2))
    expect(w.text()).not.toContain(fmtYuan(m.endValue))
    // 百分比类不变
    expect(w.text()).toContain(retText)
    expect(w.text()).toContain(ddText)
  })

  it('窗口切换: 指标切换为对应窗口数据, 无新增网络请求', async () => {
    const { calls } = installFetch()
    const w = mountCard()
    await flushPromises()
    expect(calls.length).toBe(1) // 仅产物请求

    // 断言限定在指标网格 (y5 与 full 期末资产同终点相等, 逐年表含累计值会干扰全文断言)
    const grid = () => w.find('.grid.grid-cols-2')
    const full = metricsOf('1.000001', '0.0005', 'full')
    const y5 = metricsOf('1.000001', '0.0005', 'y5')
    expect(grid().text()).toContain(fmtYuan(full.totalInvested))

    await clickButton(w, '近5年')

    expect(grid().text()).toContain(fmtYuan(y5.totalInvested))
    expect(grid().text()).not.toContain(fmtYuan(full.totalInvested))
    expect(grid().text()).toContain(fmtYuan(y5.endValue))
    expect(calls.length).toBe(1) // 零新增请求
  })

  it('自定义费率: 输入 0.2% 防抖 500ms 后调 /api/backtest?fee=0.002, 预设档切换不请求', async () => {
    vi.useFakeTimers()
    const { backtestCalls } = installFetch()
    const w = mountCard()
    await flushPromises()

    // 切到自定义费率档 (fee 行末尾的"自定义"按钮)
    const customBtns = w.findAll('button').filter(b => b.text() === '自定义')
    await customBtns[customBtns.length - 1].trigger('click')
    const feeInput = w.findAll('input[type="number"]').find(i => i.attributes('max') === '3')
    expect(feeInput, '自定义费率输入框应出现').toBeTruthy()
    await feeInput!.setValue('0.2')

    // 防抖中: 尚未请求
    expect(backtestCalls().length).toBe(0)
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()

    expect(backtestCalls().length).toBe(1)
    const url = backtestCalls()[0]
    expect(url).toContain('/api/backtest?')
    expect(url).toContain('target=1.000001')
    expect(url).toContain('fee=0.002')
    expect(url).toContain('window=full')
    expect(url).toContain('strategy=a')

    // 切回预设档: 不触发新请求
    await clickButton(w, '0.15%')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    expect(backtestCalls().length).toBe(1)
  })
})
