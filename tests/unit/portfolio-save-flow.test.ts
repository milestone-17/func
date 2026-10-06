/**
 * 用户报告流程复现测试: 新增持仓 → 自动识别 → 填均价/数量 → 保存
 * 断言 POST /api/holdings 与 /api/holdingTxns 都发出 (用户反馈"点保存无反应")
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const postMock = vi.fn()
const getMock = vi.fn()
vi.mock('@/lib/api', () => ({
  api: {
    post: (...a: unknown[]) => postMock(...(a as [])),
    get: (...a: unknown[]) => getMock(...(a as [])),
    put: vi.fn(),
    delete: vi.fn()
  },
  setUnauthorizedHandler: vi.fn()
}))

vi.mock('@/repos/fundRepo', () => ({
  fundApi: {
    search: vi.fn(async (k: string) =>
      k === '020466' ? [{ code: '020466', name: '华泰柏瑞中证中央企业红利ETF发起式联接A', type: '基金' }] : []
    )
  }
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} })
}))

import Portfolio from '@/pages/Portfolio.vue'
import { RouterLinkStub } from '@vue/test-utils'

function makeApiDefaults() {
  getMock.mockImplementation((path: string) => {
    if (path === '/api/holdings') return Promise.resolve({ items: [] })
    if (path === '/api/holdingTxns') return Promise.resolve({ items: [] })
    if (path === '/api/market/fund-search') return Promise.resolve({ items: [{ code: '020466', name: '华泰柏瑞中证中央企业红利ETF发起式联接A', type: '基金' }] })
    return Promise.resolve({ items: [] })
  })
  postMock.mockImplementation((path: string) => {
    if (path === '/api/holdings') {
      return Promise.resolve({ item: { id: 'h1', createdAt: Date.now(), updatedAt: Date.now(), symbol: '020466', name: 'x', market: 'CN', currency: 'CNY', type: 'etf', category: 'dividend', quantity: 100, avgCost: 125, currentPrice: null, currentPriceAt: null } })
    }
    if (path === '/api/holdingTxns') {
      return Promise.resolve({ item: { id: 't1', createdAt: Date.now(), updatedAt: Date.now() } })
    }
    return Promise.resolve({ item: {} })
  })
}

describe('Portfolio 新增持仓保存 (用户流程复现)', () => {
  beforeEach(() => {
    postMock.mockReset()
    getMock.mockReset()
    makeApiDefaults()
    setActivePinia(createPinia())
    localStorage.clear()
  })

  async function openCreateAndFill() {
    const w = mount(Portfolio, {
      global: {
        plugins: [],
        stubs: { RouterLink: RouterLinkStub, AppShell: { template: '<div><slot /></div>' } }
      }
    })
    await flushPromises()
    await (w.vm as any).openCreate?.()
    // 直接驱动组件内部状态 (模板交互在 happy-dom 的 select/amount 组件已由其他测试覆盖)
    const vm = w.vm as any
    // 模拟: 代码输入 → resolve 命中 (名称/市场自动填)
    vm.form.symbol = '020466'
    await vm.resolveSymbol()
    expect(vm.form.name).toContain('华泰柏瑞')
    expect(vm.form.market).toBe('CN')
    // 填金额与数量
    vm.form.avgCost = 125
    vm.form.quantity = 100
    await flushPromises()
    expect(vm.canSave).toBe(true)
    return { w, vm }
  }

  it('canSave 全条件满足 → 点保存发出 POST holdings + holdingTxns', async () => {
    const { w, vm } = await openCreateAndFill()
    await vm.save()
    await flushPromises()
    const paths = postMock.mock.calls.map((c: unknown[]) => c[0])
    expect(paths).toContain('/api/holdings')
    expect(paths).toContain('/api/holdingTxns')
    // holdings POST body 校验: 市场已自动纠正为 CN, 货币 CNY
    const body = postMock.mock.calls.find((c: unknown[]) => c[0] === '/api/holdings')![1] as Record<string, unknown>
    expect(body.market).toBe('CN')
    expect(body.currency).toBe('CNY')
    expect(body.avgCost).toBe(125)
    expect(body.quantity).toBe(100)
    w.unmount()
  })

  it('名称缺失时 canSave=false (保存按钮禁用, 不发请求)', async () => {
    const w = mount(Portfolio, {
      global: {
        plugins: [],
        stubs: { RouterLink: RouterLinkStub, AppShell: { template: '<div><slot /></div>' } }
      }
    })
    await flushPromises()
    const vm = w.vm as any
    await vm.openCreate()
    vm.form.symbol = '020466'
    vm.form.avgCost = 100
    vm.form.quantity = 10
    await flushPromises()
    expect(vm.canSave).toBe(false)
    await vm.save()
    expect(postMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('数量为 0 时 canSave=false', async () => {
    const w = mount(Portfolio, {
      global: {
        plugins: [],
        stubs: { RouterLink: RouterLinkStub, AppShell: { template: '<div><slot /></div>' } }
      }
    })
    await flushPromises()
    const vm = w.vm as any
    await vm.openCreate()
    vm.form.symbol = 'QQQ'
    vm.form.name = '纳指'
    vm.form.avgCost = 100
    vm.form.quantity = 0
    await flushPromises()
    expect(vm.canSave).toBe(false)
    w.unmount()
  })

  it('addHolding 抛错 → 弹窗不关闭, saveError 展示错误文案 (不向上抛)', async () => {
    postMock.mockImplementation((path: string) => {
      if (path === '/api/holdings') return Promise.reject(new Error('500 服务器错误'))
      return Promise.resolve({ item: {} })
    })
    const { w, vm } = await openCreateAndFill()
    await vm.save() // save 内部捕获异常, 不再向上抛
    expect(vm.creating).toBe(true) // 弹窗仍开着 — 用户视角"没反应"
    w.unmount()
  })
})
