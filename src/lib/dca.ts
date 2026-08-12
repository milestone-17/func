import { lookupBucket } from './table'
import { computeDeviation } from './deviation'

export interface WeeklyDCAConfig {
  weeklySplits: [number, number, number, number]
}

export interface IndexSnapshot {
  close: number
  ma250: number
}

export interface SuggestionResult {
  weekIndex: 1 | 2 | 3 | 4
  currentSplit: number
  deviation: number
  bucket: { rate: number; label: string; side: 'high' | 'low' | 'flat' }
  suggestedAmount: number
  exceedsSplit: boolean
}

export function computeWeekSuggestion(
  cfg: WeeklyDCAConfig,
  idx: IndexSnapshot,
  weekIndex: 1 | 2 | 3 | 4
): SuggestionResult {
  if (weekIndex < 1 || weekIndex > 4) throw new Error('weekIndex must be 1-4')
  const currentSplit = cfg.weeklySplits[weekIndex - 1]
  const deviation = computeDeviation(idx.close, idx.ma250)
  const bucket = lookupBucket(deviation)
  const suggestedAmount = Math.round(currentSplit * bucket.rate)
  return {
    weekIndex,
    currentSplit,
    deviation,
    bucket,
    suggestedAmount,
    exceedsSplit: suggestedAmount > currentSplit
  }
}
