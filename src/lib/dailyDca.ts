/**
 * 每日定投核心逻辑 (纯函数, 便于测试)
 *
 * 价格/金额均以 "分" 为单位存储。份额 = 金额(分) / 价格(分/份)。
 * 浏览器关闭时不会执行; 仅在应用打开时由 store 触发幂等校验。
 */
import type { DailyDcaConfig } from '@/types/dca'
import type { Holding, HoldingTxn } from '@/types/portfolio'

/** 当日是否应执行定投 (幂等: 同日重复判定为 false) */
export function shouldExecuteToday(cfg: DailyDcaConfig | null | undefined, todayISO: string): boolean {
  if (!cfg) return false
  if (!cfg.enabled) return false
  if (!cfg.holdingId) return false
  if (!(cfg.dailyAmountFen > 0)) return false
  return cfg.lastExecutedDate !== todayISO
}

export type DailyBuyResult =
  | { ok: true; txn: Omit<HoldingTxn, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> }
  | { ok: false; reason: 'no-price' | 'invalid' }

/**
 * 计算每日定投的买入交易。
 * 无有效现价 → 返回 no-price, 不记账 (绝不用 0/错误价买入)。
 */
export function computeDailyBuy(
  cfg: DailyDcaConfig,
  holding: Holding | undefined,
  todayISO: string
): DailyBuyResult {
  if (!holding) return { ok: false, reason: 'invalid' }
  const price = holding.currentPrice ?? null
  if (price == null || !(price > 0)) return { ok: false, reason: 'no-price' }
  const amountFen = cfg.dailyAmountFen
  if (!(amountFen > 0)) return { ok: false, reason: 'invalid' }
  const quantity = amountFen / price
  const txn: Omit<HoldingTxn, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> = {
    holdingId: holding.id,
    side: 'buy',
    date: todayISO,
    price,
    quantity,
    fee: 0,
    note: '每日定投自动'
  }
  return { ok: true, txn }
}
