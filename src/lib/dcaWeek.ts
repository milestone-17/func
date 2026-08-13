/**
 * 周度/日度定投工具函数
 */

/**
 * 计算给定日期在本月属于第几周 (1..4, 不补到 5)
 * 算法: 取 ISO 周一为起点, 月初到该日的天数 / 7 + 1 (从 1 开始计)
 * 例如:
 *   2026-08-01(六) → 第 1 周 (月内 1..7)
 *   2026-08-10(一) → 第 2 周
 *   2026-08-31(一) → 第 5 周 (但我们 cap 在 4, 见 weekOfMonth)
 */
export function weekOfMonth(dateISO: string): 1 | 2 | 3 | 4 {
  const d = new Date(dateISO)
  if (Number.isNaN(d.getTime())) return 1
  const day = d.getUTCDate()
  // 直接按 1-7/8-14/15-21/22-28 分桶, 22 日之后一律 4 周 (容错月末 5 周情形)
  if (day <= 7) return 1
  if (day <= 14) return 2
  if (day <= 21) return 3
  return 4
}

/**
 * 当月字符串, e.g. '2026-08'
 */
export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7)
}
