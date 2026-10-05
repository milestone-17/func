/** 周度定投工具: 与前端 src/lib/dcaWeek.ts 同口径 */

/** 月内第几周 (1..4): 1-7/8-14/15-21/22+ 分桶 */
export function weekOfMonth(dateISO: string): 1 | 2 | 3 | 4 {
  const d = new Date(dateISO)
  if (Number.isNaN(d.getTime())) return 1
  const day = d.getUTCDate()
  if (day <= 7) return 1
  if (day <= 14) return 2
  if (day <= 21) return 3
  return 4
}

/** 当月字符串, e.g. '2026-08' */
export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7)
}
