/**
 * 备份到期提醒判断 (纯函数, 便于单元测试 —— 注入 now 即可)
 */

export interface ReminderInput {
  lastBackupAt: number | null | undefined      // 最近备份时间
  firstDataAt: number | null | undefined       // 首次产生数据时间 (最早记录 createdAt)
  snoozedAt: number | null | undefined         // "稍后提醒" 时间
  reminderDays: number | undefined             // 阈值 (默认 30)
  now: number                                  // 当前时间戳
}

const DEFAULT_DAYS = 30

/** 自 ts 至 now 的天数 (向下取整) */
export function daysSince(ts: number | null | undefined, now: number): number {
  if (ts == null) return Infinity
  return Math.floor((now - ts) / 86_400_000)
}

/**
 * 是否应该提醒备份。
 * 规则:
 * - 无数据 (firstDataAt 为空) → 不提醒
 * - 处于"稍后提醒"推迟期内 (距 snoozedAt < 阈值) → 不提醒
 * - 基准时间 = lastBackupAt ?? firstDataAt (从未备份则以首次有数据时间为准)
 * - 距基准时间 ≥ 阈值 → 提醒
 */
export function shouldRemindBackup(input: ReminderInput): boolean {
  const { lastBackupAt, firstDataAt, snoozedAt, now } = input
  const days = input.reminderDays && input.reminderDays > 0 ? input.reminderDays : DEFAULT_DAYS

  // 无数据, 无须备份
  if (firstDataAt == null) return false

  // 推迟期内
  if (snoozedAt != null && daysSince(snoozedAt, now) < days) return false

  const baseline = lastBackupAt ?? firstDataAt
  return daysSince(baseline, now) >= days
}
