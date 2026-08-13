import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { holdingRepo } from '@/repos/holdingRepo'
import { holdingTxnRepo } from '@/repos/holdingTxnRepo'
import { convertCurrency } from '@/lib/currency'
import { fetchHoldingPrices } from '@/lib/yahoo'
import { yuanToFen } from '@/lib/money'
import { inferCategory } from '@/lib/category'
import { computePosition, settleDaysOf } from '@/lib/position'
import { suggestSettleDays, isSettled } from '@/lib/settlement'
import { planConversion, type ConvertPlan } from '@/lib/conversion'
import { useSettingsStore } from '@/stores/settings'
import type { Holding, HoldingTxn, Currency, Market, HoldingCategory } from '@/types/portfolio'

function todayISO(): string {
  if (_todayOverride) return _todayOverride
  return new Date().toISOString().slice(0, 10)
}

/** 测试注入点: 通过 setTodayForTests 覆盖 todayISO 返回值 */
let _todayOverride: string | null = null
export function setTodayForTests(d: string | null) {
  _todayOverride = d
}

/** 交易结果: ok=true 返回本次份额; ok=false 返回原因 */
export type TradeResult =
  | { ok: true; quantity: number; pending: boolean }
  | { ok: false; reason: 'no-price' | 'invalid' | 'exceeds-held' | 'not-found' | 'amount-exceeds' }

/** 转换结果: 成功返回两侧交易参数 + 时间线; 失败返回原因 */
export type ConvertResult =
  | { ok: true; plan: ConvertPlan; sourceHoldingId: string; targetHoldingId: string; targetCreated: boolean }
  | { ok: false; reason: 'no-price' | 'invalid' | 'exceeds-held' | 'not-found' | 'same-target' | 'no-target-price' | 'amount-exceeds' }

export interface HoldingView {
  id: string
  symbol: string
  name: string
  market: Market
  currency: Currency
  type: string
  category: HoldingCategory
  quantity: number
  avgCost: number
  settleDays: number
  currentPrice: number | null
  currentPriceIsEstimate: boolean
  pendingBuyFen: number
  pendingSellFen: number
  frozenShares: number
  isClosed: boolean
  marketValueOriginal: number | null
  marketValueCNY: number | null
  totalCost: number
  unrealized: number | null
  unrealizedPct: number | null
}

export const usePortfolioStore = defineStore('portfolio', () => {
  const holdings = ref<HoldingView[]>([])
  const loaded = ref(false)

  async function refresh() {
    const settings = useSettingsStore()
    if (!settings.loaded) await settings.load()
    const list = await holdingRepo.list()
    // 存量自动分类: 缺失 category 的持仓按名称/代码推断并持久化补齐 (读取即生效, 无需手动)
    const missingCat = list.filter(h => !h.category)
    if (missingCat.length > 0) {
      for (const h of missingCat) {
        h.category = inferCategory(h.name, h.symbol)
        await holdingRepo.put(h)
      }
    }
    const out: HoldingView[] = []
    for (const h of list) {
      const txns = await holdingTxnRepo.listByHolding(h.id)
      const settleDays = settleDaysOf(h)
      const pos = computePosition(txns, settleDays, todayISO(), { quantity: h.quantity || 0, avgCost: h.avgCost || 0 })
      const { quantity, avgCost } = pos
      const totalCost = Math.round(quantity * avgCost)
      const rate = settings.settings?.usdCnyRate || 7.2
      const price = h.currentPrice ?? null
      let marketValueOriginal: number | null = null
      let marketValueCNY: number | null = null
      let unrealized: number | null = null
      let unrealizedPct: number | null = null
      if (price != null) {
        marketValueOriginal = Math.round(price * quantity)
        marketValueCNY = h.currency === 'CNY' ? marketValueOriginal : convertCurrency(marketValueOriginal, 'USD', 'CNY', rate)
        unrealized = marketValueOriginal - totalCost
        unrealizedPct = totalCost > 0 ? (unrealized / totalCost) * 100 : Infinity
      }
      out.push({
        id: h.id, symbol: h.symbol, name: h.name,
        market: h.market, currency: h.currency, type: h.type, category: h.category ?? 'other',
        quantity, avgCost, settleDays,
        currentPrice: price, currentPriceIsEstimate: h.currentPriceIsEstimate ?? false,
        pendingBuyFen: pos.pendingBuyFen, pendingSellFen: pos.pendingSellFen, frozenShares: pos.frozenShares,
        isClosed: quantity === 0 && txns.length > 0,
        marketValueOriginal, marketValueCNY, totalCost, unrealized, unrealizedPct
      })
    }
    holdings.value = out
    loaded.value = true
  }

  async function addHolding(input: Omit<Holding, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Holding> {
    // 新建基金/持仓默认结算天数: 名称含跨境关键词 → T+2, 其余基金 → T+1, 非基金即时(0)
    const settleDays = input.settleDays != null && input.settleDays > 0
      ? input.settleDays
      : (/^\d{6}$/.test(input.symbol) || input.market === 'CN') ? suggestSettleDays(input.name) : 0
    const h = await holdingRepo.add({ ...input, settleDays })
    await refresh()
    return h
  }

  async function updatePrice(id: string, priceFen: number, isEstimate = false) {
    const h = await holdingRepo.get(id)
    if (!h) return
    h.currentPrice = priceFen
    h.currentPriceAt = Date.now()
    h.currentPriceIsEstimate = isEstimate
    await holdingRepo.put(h)
    await refresh()
  }

  /**
   * 拉取全部持仓最新价。两段式, 保证基金批量不被美股回落阻塞:
   * (a) 6 位基金代码一次批量 JSONP 回填, 立即 refresh 显示;
   * (b) 未命中基金 + 字母代码逐只回落 (push2 / Yahoo), 全部失败保留原值, 仅计入 failed, 绝不清空。
   */
  async function refreshAllPrices(): Promise<{ updated: number; failed: { id: string; name: string }[] }> {
    const list = await holdingRepo.list()
    const failed: { id: string; name: string }[] = []
    let updated = 0
    const numericIds = new Set<string>()
    const fundCodes: string[] = []
    for (const h of list) {
      if (/^\d{6}$/.test(h.symbol)) { numericIds.add(h.id); fundCodes.push(h.symbol) }
    }
    // (a) 6 位基金代码 → 一次批量 JSONP, 立即回填
    const fundMissed = new Set<string>()
    if (fundCodes.length > 0) {
      const { fetchFundNavs } = await import('@/lib/fundQuote')
      const fundMap = await fetchFundNavs(fundCodes)
      for (const h of list) {
        if (!numericIds.has(h.id)) continue
        const f = fundMap.get(h.symbol)
        if (f && f.nav > 0) {
          h.currentPrice = yuanToFen(f.nav)
          h.currentPriceAt = Date.now()
          h.currentPriceIsEstimate = f.isEstimate
          await holdingRepo.put(h)
          updated++
        } else {
          fundMissed.add(h.id)
        }
      }
      await refresh() // 基金净值先显示, 不等美股回落
    }
    // (b) 基金未命中(回落 push2) + 字母代码(走 Yahoo): 并行、各自限时
    const rest = list.filter(h => !numericIds.has(h.id) || fundMissed.has(h.id))
    if (rest.length > 0) {
      const results = await fetchHoldingPrices(rest.map(h => ({ id: h.id, market: h.market, symbol: h.symbol })))
      for (const r of results) {
        const h = list.find(x => x.id === r.id)
        if (!h) continue
        if (r.price != null && r.price > 0) {
          h.currentPrice = yuanToFen(r.price)
          h.currentPriceAt = Date.now()
          h.currentPriceIsEstimate = r.isEstimate
          await holdingRepo.put(h)
          updated++
        } else {
          failed.push({ id: r.id, name: h.name })
        }
      }
      await refresh()
    }
    return { updated, failed }
  }

  async function addTxn(input: Omit<HoldingTxn, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
    await holdingTxnRepo.add(input)
    await refresh()
  }

  /**
   * 超级转换: 转出源持仓的部分/全部, 按目标净值买入目标持仓。
   * 目标若未添加则自动建仓 (按名称推断分类、QDII 关键词推断 settleDays)。
   * 生成 sell + buy 两条交易, 一次操作完成。
   */
  async function convertPosition(
    sourceId: string,
    target: { symbol: string; name?: string; priceFen: number; currentPriceFen?: number },
    input: { mode: 'all' | 'shares' | 'amount'; value?: number; feeFen?: number; date?: string }
  ): Promise<ConvertResult> {
    const src = await holdingRepo.get(sourceId)
    if (!src) return { ok: false, reason: 'not-found' }
    if (src.symbol === target.symbol) return { ok: false, reason: 'same-target' }
    const srcPrice = src.currentPrice ?? null
    if (srcPrice == null || !(srcPrice > 0)) return { ok: false, reason: 'no-price' }
    if (!(target.priceFen > 0)) return { ok: false, reason: 'no-target-price' }

    const txns = await holdingTxnRepo.listByHolding(sourceId)
    const settleDays = settleDaysOf(src)
    const pos = computePosition(txns, settleDays, todayISO(), { quantity: src.quantity || 0, avgCost: src.avgCost || 0 })
    const held = pos.quantity
    if (held <= 0) return { ok: false, reason: 'invalid' }

    let sourceShares: number | null = null
    let amountFen: number | null = null
    if (input.mode === 'all') {
      sourceShares = held
    } else if (input.mode === 'shares') {
      const v = input.value ?? 0
      if (!(v > 0)) return { ok: false, reason: 'invalid' }
      if (v > held + 1e-9) return { ok: false, reason: 'exceeds-held' }
      sourceShares = v
    } else {
      const v = yuanToFen(input.value ?? 0)
      if (!(v > 0)) return { ok: false, reason: 'invalid' }
      const heldFen = Math.round(held * srcPrice)
      if (v > heldFen) return { ok: false, reason: 'amount-exceeds' }
      amountFen = v
    }

    // 解析/创建目标持仓
    let tgt = (await holdingRepo.list()).find(h => h.symbol === target.symbol && !h.deletedAt)
    let targetCreated = false
    if (!tgt) {
      const isCN = /^\d{6}$/.test(target.symbol) || target.symbol.length === 6
      const market: Market = isCN ? 'CN' : 'US'
      const currency: Currency = isCN ? 'CNY' : 'USD'
      const name = target.name?.trim() || target.symbol
      const cat: HoldingCategory = inferCategory(name, target.symbol)
      tgt = await holdingRepo.add({
        symbol: target.symbol, name, market, currency, type: 'etf', category: cat,
        quantity: 0, avgCost: 0, currentPrice: target.priceFen, currentPriceAt: Date.now(),
        settleDays: suggestSettleDays(name)
      })
      targetCreated = true
    } else if (tgt.currentPrice == null || tgt.currentPrice <= 0) {
      // 已存在但无现价: 仍允许用本次目标价作为买入价 (临时参考)
      tgt.currentPrice = target.priceFen
      tgt.currentPriceAt = Date.now()
      await holdingRepo.put(tgt)
    }

    const today = input.date ?? todayISO()
    const plan = planConversion({
      sourceShares, amountFen,
      sourcePriceFen: srcPrice, targetPriceFen: target.priceFen,
      sourceSettleDays: settleDays, targetSettleDays: settleDaysOf(tgt),
      feeFen: input.feeFen ?? 0, todayISO: today
    })

    // 落库 sell (源) + buy (目标)
    const tag = targetCreated ? '[新建目标]' : ''
    await holdingTxnRepo.add({
      holdingId: sourceId, side: 'sell', date: today, price: srcPrice, quantity: plan.sourceShares,
      fee: 0, note: `转换出→${target.symbol} ${tag}`.trim()
    })
    await holdingTxnRepo.add({
      holdingId: tgt.id, side: 'buy', date: today, price: target.priceFen, quantity: plan.targetShares,
      fee: 0, note: `转换入←${src.symbol} ${tag}`.trim()
    })
    await refresh()
    return { ok: true, plan, sourceHoldingId: sourceId, targetHoldingId: tgt.id, targetCreated }
  }

  /**
   * 加仓: 按金额(元)或份额买入。
   * 份额 = 金额(分)/净值(分)。需要有效现价 (无则 no-price)。
   * 确认中份额由结算规则 (settleDays) 在 refresh 中呈现为 pending。
   */
  async function addPosition(
    id: string,
    input: { mode: 'amount' | 'shares'; value: number; feeFen?: number; date?: string }
  ): Promise<TradeResult> {
    const h = await holdingRepo.get(id)
    if (!h) return { ok: false, reason: 'not-found' }
    const price = h.currentPrice ?? null
    if (price == null || !(price > 0)) return { ok: false, reason: 'no-price' }
    let quantity: number
    if (input.mode === 'amount') {
      const amountFen = yuanToFen(input.value)
      if (!(amountFen > 0)) return { ok: false, reason: 'invalid' }
      quantity = amountFen / price
    } else {
      if (!(input.value > 0)) return { ok: false, reason: 'invalid' }
      quantity = input.value
    }
    await holdingTxnRepo.add({
      holdingId: id, side: 'buy',
      date: input.date ?? todayISO(), price, quantity,
      fee: input.feeFen ?? 0, note: input.mode === 'amount' ? '加仓(按金额)' : '加仓(按份额)'
    })
    await refresh()
    const settleDays = settleDaysOf(h)
    const pending = !isSettled(input.date ?? todayISO(), settleDays, todayISO())
    return { ok: true, quantity, pending }
  }

  /**
   * 减仓/卖出: 按份额、金额或全部。
   * 校验: 份额 ≤ 当前已确认持有数量; 金额 ≤ 持有市值。全部卖出后数量归零置 isClosed。
   */
  async function reducePosition(
    id: string,
    input: { mode: 'amount' | 'shares' | 'all'; value?: number; feeFen?: number; date?: string }
  ): Promise<TradeResult> {
    const h = await holdingRepo.get(id)
    if (!h) return { ok: false, reason: 'not-found' }
    const price = h.currentPrice ?? null
    if (price == null || !(price > 0)) return { ok: false, reason: 'no-price' }
    const txns = await holdingTxnRepo.listByHolding(id)
    const settleDays = settleDaysOf(h)
    const pos = computePosition(txns, settleDays, todayISO(), { quantity: h.quantity || 0, avgCost: h.avgCost || 0 })
    const held = pos.quantity
    let quantity: number
    if (input.mode === 'all') {
      quantity = held
    } else if (input.mode === 'shares') {
      quantity = input.value ?? 0
    } else {
      const amountFen = yuanToFen(input.value ?? 0)
      if (!(amountFen > 0)) return { ok: false, reason: 'invalid' }
      const heldFen = Math.round(held * price)
      if (amountFen > heldFen) return { ok: false, reason: 'amount-exceeds' }
      quantity = amountFen / price
    }
    if (!(quantity > 0)) return { ok: false, reason: 'invalid' }
    if (quantity > held + 1e-9) return { ok: false, reason: 'exceeds-held' }
    quantity = Math.min(quantity, held)
    await holdingTxnRepo.add({
      holdingId: id, side: 'sell',
      date: input.date ?? todayISO(), price, quantity,
      fee: input.feeFen ?? 0, note: input.mode === 'all' ? '全部卖出' : input.mode === 'amount' ? '减仓(按金额)' : '减仓(按份额)'
    })
    await refresh()
    const pending = !isSettled(input.date ?? todayISO(), settleDays, todayISO())
    return { ok: true, quantity, pending }
  }

  /**
   * 按名称/代码批量重新自动分类。
   * scope='unclassified' 仅重算「其他」(默认, 不覆盖用户手动设置); 'all' 重算全部。
   * 返回被改变的持仓数。
   */
  async function reclassifyAll(scope: 'unclassified' | 'all' = 'unclassified'): Promise<number> {
    const list = await holdingRepo.list()
    let n = 0
    for (const h of list) {
      if (scope === 'unclassified' && h.category && h.category !== 'other') continue
      const next = inferCategory(h.name, h.symbol)
      if (next !== (h.category ?? 'other')) {
        h.category = next
        await holdingRepo.put(h)
        n++
      }
    }
    await refresh()
    return n
  }

  const totalMarketValueCNY = computed(() =>
    holdings.value.reduce((s, h) => s + (h.marketValueCNY || 0), 0)
  )
  const totalCost = computed(() => holdings.value.reduce((s, h) => s + h.totalCost, 0))
  const totalUnrealized = computed(() => holdings.value.reduce((s, h) => s + (h.unrealized || 0), 0))

  /** 按 category 聚合: category -> { 小计市值(CNY), 数量 } */
  const byCategory = computed(() => {
    const map: Record<string, { marketValueCNY: number; count: number }> = {}
    for (const h of holdings.value) {
      const cat = h.category
      if (!map[cat]) map[cat] = { marketValueCNY: 0, count: 0 }
      map[cat].marketValueCNY += h.marketValueCNY || 0
      map[cat].count += 1
    }
    return map
  })

  return { holdings, loaded, refresh, addHolding, updatePrice, refreshAllPrices, addTxn, addPosition, reducePosition, convertPosition, reclassifyAll, totalMarketValueCNY, totalCost, totalUnrealized, byCategory }
})
