/**
 * 投资 → 账本 同步
 * 买入 (加仓/定投/转换入) → 账本支出; 卖出 (减仓/转换出) → 账本收入。
 * 自动创建/复用「投资」分类, 单条失败不阻断主流程 (尽力同步)。
 */
import { transactionRepo } from '@/repos/transactionRepo'
import { categoryRepo } from '@/repos/categoryRepo'
import { newId } from '@/repos/base'
import type { ISODate } from '@/types/common'

let investCategoryId: string | null | undefined

/** 取或建「投资」支出分类 (缓存结果) */
async function investmentCategoryId(): Promise<string | null> {
  if (investCategoryId !== undefined) return investCategoryId
  try {
    const cats = await categoryRepo.list()
    const found = cats.find(c => c.name === '投资')
    if (found) {
      investCategoryId = found.id
      return investCategoryId
    }
    const created = await categoryRepo.add({
      name: '投资',
      type: 'expense',
      color: '#38bdf8',
      icon: '📈',
      order: 7
    })
    investCategoryId = created.id
    return investCategoryId
  } catch {
    investCategoryId = null
    return null
  }
}

export interface InvestTxnInput {
  /** 金额 (分) — 必须 > 0 */
  amountFen: number
  /** 'buy' → 支出 (现金流出); 'sell' → 收入 (现金回流) */
  side: 'buy' | 'sell'
  date: ISODate
  /** 账本备注, 如: 加仓 恒生科技ETF华夏(513180) */
  note: string
}

/** 同步一笔投资现金流到账本。失败静默 (返回 false), 不影响持仓主流程 */
export async function syncInvestToLedger(input: InvestTxnInput): Promise<boolean> {
  try {
    if (!(input.amountFen > 0)) return false
    const categoryId = await investmentCategoryId()
    if (!categoryId) return false
    const now = Date.now()
    await transactionRepo.add({
      id: newId(),
      date: input.date,
      type: input.side === 'buy' ? 'expense' : 'income',
      amount: input.amountFen,
      categoryId,
      note: input.note,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    })
    return true
  } catch {
    return false
  }
}

/** 持仓名称备注后缀 */
export function holdingNote(name: string | undefined, symbol: string): string {
  return name ? `${name}(${symbol})` : symbol
}
