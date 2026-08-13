/**
 * 持仓重建 (结算感知): 由交易记录计算当前持仓数量/均价, 以及确认中份额与在途资金。
 *
 * 与 `holdingTxnRepo.computeAvgCost` 的区别:
 * - computeAvgCost 把全部交易计入 (兼容旧行为/既有测试);
 * - computePosition 只计入"已确认"的买入与"已到账"的卖出, 并单独报告
 *   确认中的买入金额 (pendingBuyFen) 与在途卖出 (frozenShares + pendingSellFen)。
 *
 * 规则 (对齐 fund-settlement spec):
 * - buy:  确认前份额不计入数量/成本, 金额计入 pendingBuyFen;
 * - sell: 到账前份额仍计入数量 (冻结), 到账后扣减数量与成本。
 */
import type { HoldingTxn } from '@/types/portfolio'
import { isSettled } from '@/lib/settlement'

export interface Position {
  quantity: number
  avgCost: number // 分
  pendingBuyFen: number // 确认中买入的在途金额
  pendingSellFen: number // 卖出未到账的在途资金
  frozenShares: number // 卖出未到账、仍计入持仓的份额
}

export function computePosition(
  txns: HoldingTxn[],
  settleDays: number,
  todayISO: string,
  initial: { quantity: number; avgCost: number } = { quantity: 0, avgCost: 0 }
): Position {
  // 起点: 仅当该持仓没有任何交易记录时, 才把持仓自带的存量 (quantity + avgCost)
  // 视为"建仓前已持有"的种子。凡有首笔交易的持仓一律以交易为准 —— 本应用表单创建
  // 持仓必定同时写入首笔买入, 若再把 quantity 作种子叠加, 会与首笔交易重复计入而翻倍。
  const hasTxns = txns.length > 0
  let qty = hasTxns ? 0 : initial.quantity
  let cost = hasTxns ? 0 : Math.round(initial.avgCost * initial.quantity)
  let pendingBuyFen = 0
  let pendingSellFen = 0
  let frozenShares = 0

  for (const t of txns) {
    const q = t.quantity ?? 0
    const settled = isSettled(t.date, settleDays, todayISO)
    if (t.side === 'buy') {
      if (settled) {
        cost += (t.price ?? 0) * q + (t.fee || 0)
        qty += q
      } else {
        // 确认中的买入: 金额在途 (含申购费), 不计入数量
        pendingBuyFen += (t.price ?? 0) * q + (t.fee || 0)
      }
    } else if (t.side === 'sell') {
      if (settled) {
        const avg = qty > 0 ? cost / qty : 0
        cost -= avg * q
        qty -= q
        pendingSellFen += (t.price ?? 0) * q - (t.fee || 0)
      } else {
        // 未到账卖出: 份额仍计入数量 (冻结), 卖出金额在途
        frozenShares += q
        pendingSellFen += (t.price ?? 0) * q - (t.fee || 0)
      }
    }
    // dividend/fee 不改变数量/成本
  }

  const avgCost = qty > 0 ? cost / qty : 0
  return {
    quantity: qty,
    avgCost: Math.round(avgCost * 100) / 100,
    pendingBuyFen: Math.round(pendingBuyFen),
    pendingSellFen: Math.round(pendingSellFen),
    frozenShares
  }
}

/**
 * 解析某持仓的结算天数:
 * - 显式配置 (settleDays>0) 优先;
 * - 未配置时按 6 位基金代码 / CN 基金 → 1 (T+1), 其余 → 0 (即时)。
 * 存量美股持仓无配置 → 0, 行为零变化。
 */
export function settleDaysOf(h: { settleDays?: number | null; symbol: string; type: string; market: string }): number {
  if (h.settleDays != null && h.settleDays > 0) return h.settleDays
  if (/^\d{6}$/.test(h.symbol) || h.market === 'CN') return 1
  return 0
}
