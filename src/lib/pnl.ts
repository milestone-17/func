export interface PnLInput {
  quantity: number
  avgCost: number  // 分
  currentPrice: number | null  // 分
}

export interface PnLResult {
  marketValue: number | null  // 分
  totalCost: number  // 分
  unrealized: number | null  // 分
  unrealizedPct: number | null  // 百分点
}

export function computePnL(input: PnLInput): PnLResult {
  const { quantity, avgCost, currentPrice } = input
  const totalCost = Math.round(avgCost * quantity)
  if (currentPrice === null || currentPrice === undefined) {
    return { marketValue: null, totalCost, unrealized: null, unrealizedPct: null }
  }
  const marketValue = Math.round(currentPrice * quantity)
  const unrealized = marketValue - totalCost
  const unrealizedPct = totalCost === 0 ? Infinity : (unrealized / totalCost) * 100
  return { marketValue, totalCost, unrealized, unrealizedPct }
}
