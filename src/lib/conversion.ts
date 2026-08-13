/**
 * 基金超级转换 (纯计算, 便于测试)
 *
 * 输入: 源持仓 + 转出份额/金额/全部, 目标 (代码/名称/净值/结算天数), 费用。
 * 输出: 源 sell 交易 + 目标 buy 交易的参数, 以及确认/收益起算日期文案。
 *
 * 规则:
 * - 份额 = 净额(分) / 目标净值(分/份)
 * - 转出金额 = 源份额 * 源净值
 * - 净额 = 转出金额 - 双方费用
 * - 确认日与收益起算日: 双方各自按 settleDays 推算 (跨周末)
 */
import { confirmDateOf } from '@/lib/settlement'

export interface ConvertInput {
  /** 源份额: 指定则按份额; null 则按 amountFen 算份额 */
  sourceShares: number | null
  /** 源转出金额(分) */
  amountFen: number | null
  sourcePriceFen: number
  targetPriceFen: number
  sourceSettleDays: number
  targetSettleDays: number
  feeFen?: number
  todayISO: string
}

export interface ConvertPlan {
  sourceShares: number
  grossFen: number
  netFen: number
  feeFen: number
  targetShares: number
  sourceConfirmDate: string
  targetConfirmDate: string
  earningsStartDate: string
  sourcePriceFen: number
  targetPriceFen: number
}

export function planConversion(input: ConvertInput): ConvertPlan {
  const fee = Math.max(0, input.feeFen ?? 0)
  const grossFen = input.sourceShares != null
    ? Math.round(input.sourceShares * input.sourcePriceFen)
    : (input.amountFen ?? 0)
  if (grossFen <= 0) throw new Error('转出金额必须为正')
  if (!(input.targetPriceFen > 0)) throw new Error('目标净值无效')
  const netFen = Math.max(0, grossFen - fee)
  const targetShares = netFen / input.targetPriceFen
  const sourceConfirm = input.sourceSettleDays > 0
    ? confirmDateOf(input.todayISO, input.sourceSettleDays)
    : input.todayISO
  const targetConfirm = input.targetSettleDays > 0
    ? confirmDateOf(input.todayISO, input.targetSettleDays)
    : input.todayISO
  // 收益起算日: 取转出/转入两者中较晚的确认日 (晚到账者决定份额可用时点)
  const earningsStart = sourceConfirm > targetConfirm ? sourceConfirm : targetConfirm
  return {
    sourceShares: input.sourceShares != null ? input.sourceShares : grossFen / input.sourcePriceFen,
    grossFen,
    netFen,
    feeFen: fee,
    targetShares,
    sourceConfirmDate: sourceConfirm,
    targetConfirmDate: targetConfirm,
    earningsStartDate: earningsStart,
    sourcePriceFen: input.sourcePriceFen,
    targetPriceFen: input.targetPriceFen
  }
}
