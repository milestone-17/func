/**
 * 基金结算 (T+1 / T+2) 基础工具 (纯函数, 便于测试)
 *
 * 规则: 下单日 T 起, 经 settleDays 个交易日确认份额 / 资金到账。
 * 交易日近似: 仅跳过周六日, 无节假日日历 (法定节假日按普通日近似, 见 design.md D1)。
 * 所有金额/日期均为运行时推算, 不给交易增加持久化字段——历史交易日期在过去,
 * 天然全部已确认, 存量数据零迁移。
 */

/** 把 ISO 日期按交易日推进 n 天, 跳过周六周日, 返回 ISO 日期 */
export function addTradingDays(dateISO: string, n: number): string {
  const d = parseDate(dateISO)
  let added = 0
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue // 周日/周六
    added++
  }
  return formatDate(d)
}

/** 确认/到账日: 下单日 + settleDays 个交易日 */
export function confirmDateOf(dateISO: string, settleDays: number): string {
  return addTradingDays(dateISO, Math.max(0, settleDays || 0))
}

/**
 * 该交易在 givenToday 是否已确认/已到账。
 * settleDays<=0 (如美股即时结算/存量持仓无配置) 时, 下单当日即视为已确认。
 */
export function isSettled(dateISO: string, settleDays: number, todayISO: string): boolean {
  const confirm = confirmDateOf(dateISO, settleDays)
  return confirm <= todayISO
}

/** 判断某交易日期是否已结算 (交易对象形态的便捷封装) */
export function txnSettled(txn: { date: string }, settleDays: number, todayISO: string): boolean {
  return isSettled(txn.date, settleDays, todayISO)
}

/**
 * 按基金名称推断结算天数: 跨境/QDII 类 T+2, 其余 T+1。
 * 关键词覆盖常见跨境场景; 名称不含关键词按国内基金 T+1。
 */
const QDII_RE = /纳斯达克|纳指|标普|恒生|中概|海外|全球|美国|日本|日经|德国|印度|越南|原油|qdii|港股/i

export function suggestSettleDays(name: string): number {
  return QDII_RE.test(name || '') ? 2 : 1
}

function parseDate(dateISO: string): Date {
  return new Date(`${dateISO}T00:00:00Z`)
}

function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
