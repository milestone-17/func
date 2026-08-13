import type { AssetType, HoldingForPerm, PermTarget } from '@/types/permanent'

/** 持仓分类/类型 → 永久组合四类(股/债/现金/黄金) 的映射 */
export function categoryToAssetType(category: string | undefined, type: string): AssetType {
  const c = (category ?? 'other').toLowerCase()
  if (c === 'nasdaq100' || c === 'sp500' || c === 'dividend') return 'stock'
  if (c === 'bond') return 'bond'
  // 「其他」或缺省分类 → 按持仓原始 type
  switch (type) {
    case 'stock': return 'stock'
    case 'bond': return 'bond'
    case 'cash': return 'cash'
    case 'gold': return 'gold'
    default: return 'stock' // etf/crypto 等权益类默认归股票
  }
}

export function aggregateByType(holdings: HoldingForPerm[]): Record<AssetType, number> {
  const init: Record<AssetType, number> = { stock: 0, bond: 0, cash: 0, gold: 0 }
  return holdings.reduce((acc, h) => {
    const t = categoryToAssetType(h.category, h.type)
    acc[t] = (acc[t] || 0) + h.marketValueCNY
    return acc
  }, init)
}

export interface PermDeviation {
  assetType: AssetType
  targetPercent: number
  actualPercent: number
  deviation: number
  marketValue: number
}

export interface PermResult {
  total: number
  deviations: PermDeviation[]
  alerts: PermDeviation[]
}

export function computePermanentDeviation(
  holdings: HoldingForPerm[],
  targets: PermTarget[],
  thresholdPct: number
): PermResult {
  const agg = aggregateByType(holdings)
  const total = Object.values(agg).reduce((a, b) => a + b, 0)
  const deviations: PermDeviation[] = targets.map(t => {
    const mv = agg[t.assetType] || 0
    const actualPercent = total === 0 ? 0 : (mv / total) * 100
    return {
      assetType: t.assetType,
      targetPercent: t.targetPercent,
      actualPercent,
      deviation: actualPercent - t.targetPercent,
      marketValue: mv
    }
  })
  const alerts = deviations.filter(d => Math.abs(d.deviation) > thresholdPct)
  return { total, deviations, alerts }
}
