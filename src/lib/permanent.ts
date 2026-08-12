import type { AssetType, HoldingForPerm, PermTarget } from '@/types/permanent'

export function aggregateByType(holdings: HoldingForPerm[]): Record<AssetType, number> {
  const init: Record<AssetType, number> = { stock: 0, bond: 0, cash: 0, gold: 0 }
  return holdings.reduce((acc, h) => {
    acc[h.type] = (acc[h.type] || 0) + h.marketValueCNY
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
