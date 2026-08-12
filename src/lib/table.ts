import type { BucketResult } from '@/types/dca'

export function lookupBucket(deviationPct: number): BucketResult {
  // 闭-开区间 [低, 高), 上界归下一档
  // 高位
  if (deviationPct >= 100) return { rate: 0, label: '高位 100%以上', side: 'high' }
  if (deviationPct >= 50) return { rate: 0.1, label: '高位 50-100%', side: 'high' }
  if (deviationPct >= 15) return { rate: 0.4, label: '高位 15-50%', side: 'high' }
  if (deviationPct > 0) return { rate: 0.7, label: '高位 0-15%', side: 'high' }
  // 基准
  if (deviationPct === 0) return { rate: 1.0, label: '基准', side: 'flat' }
  // 低位
  if (deviationPct > -5) return { rate: 1.3, label: '低位 0-5%', side: 'low' }
  if (deviationPct > -10) return { rate: 1.6, label: '低位 5-10%', side: 'low' }
  if (deviationPct > -20) return { rate: 1.9, label: '低位 10-20%', side: 'low' }
  if (deviationPct > -30) return { rate: 2.2, label: '低位 20-30%', side: 'low' }
  if (deviationPct > -40) return { rate: 2.5, label: '低位 30-40%', side: 'low' }
  return { rate: 2.8, label: '低位 40%以上', side: 'low' }
}
