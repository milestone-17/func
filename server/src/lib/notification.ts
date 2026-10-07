/**
 * 通知引擎 (纯函数为主, 便于测试):
 *   - 槽位: Asia/Shanghai 日期 'YYYY-MM-DD' 为防重 slot; daily 每天命中, weekly 仅 dayOfWeek 命中
 *   - 内容: 定投建议金额 (MA250 偏离档位) + 上证通道 (中线/当前位/策略)
 *   - 重试: 发送失败同槽位重试, 最多 MAX_RETRY 次
 */
import { prisma } from './prisma'
import { fitChannel, parsePush2hisKline, zoneOf, ZONE_LABELS, MIN_PIVOTS, type MonthlyBar } from './channel'
import { computeDeviation } from './deviation'
import { lookupBucket } from './bucket'
import { weekOfMonth } from './dcaWeek'

export const MAX_RETRY = 3
export const SHANGHAI_TZ = 'Asia/Shanghai'

export interface NotifyConfigData {
  enabled: boolean
  notifyEmail: string
  frequency: 'daily' | 'weekly'
  dayOfWeek: number
  time: string
}

// ---------------------------------------------------------------- 上海时间

/** 当前上海时刻的日期/时间分量 (替代需要 Intl 全量数据的轻量实现: UTC+8 固定偏移) */
export function shanghaiNow(now: Date = new Date()): { date: string; time: string; dayOfWeek: number; minutes: number } {
  const sh = new Date(now.getTime() + 8 * 3600_000)
  const y = sh.getUTCFullYear()
  const m = String(sh.getUTCMonth() + 1).padStart(2, '0')
  const d = String(sh.getUTCDate()).padStart(2, '0')
  const hh = String(sh.getUTCHours()).padStart(2, '0')
  const mm = String(sh.getUTCMinutes()).padStart(2, '0')
  return {
    date: `${y}-${m}-${d}`,
    time: `${hh}:${mm}`,
    dayOfWeek: sh.getUTCDay(),
    minutes: sh.getUTCHours() * 60 + sh.getUTCMinutes()
  }
}

/** 配置时刻的分钟数 '08:30' → 510 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** date 'YYYY-MM-DD' → 上海时区下的星期 (0=周日) */
export function shanghaiDayOfWeek(dateISO: string): number {
  // 上海是 UTC+8, 取该日 12:00 UTC+8 即该日 04:00 UTC 的 UTC 星期, 与上海本地星期一致
  return new Date(`${dateISO}T04:00:00Z`).getUTCDay()
}

/**
 * 该配置在给定上海时刻是否应触发。
 * 已发送槽位 → false (防重, 幂等)。
 * 时间语义: now.time >= cfg.time 即视为到达配置时刻 (引擎每分钟 tick, 允许失败后
 * 同槽位后续分钟重试; 首次成功后由 lastSentSlot 防重)。
 */
export function shouldFire(
  cfg: NotifyConfigData,
  now: { date: string; time: string; dayOfWeek: number },
  lastSentSlot: string | null
): boolean {
  if (!cfg.enabled) return false
  if (lastSentSlot === now.date) return false // 同槽位已发
  if (timeToMinutes(now.time) < timeToMinutes(cfg.time)) return false
  if (cfg.frequency === 'weekly' && cfg.dayOfWeek !== now.dayOfWeek) return false
  return true
}

/** 月内第几周 (1-4): 与前端 dcaWeek.weekOfMonth 同口径 (1-7/8-14/15-21/22+) */
export function weekOfMonthOf(dateISO: string): 1 | 2 | 3 | 4 {
  const day = Number(dateISO.slice(8, 10))
  if (day <= 7) return 1
  if (day <= 14) return 2
  if (day <= 21) return 3
  return 4
}

// ---------------------------------------------------------------- 数据读取

export interface IndexCloseRow { date: string; close: number }

/** 目标指数日K (升序); symbol 如 ^NDX 或基金 code */
export async function loadCloses(symbol: string): Promise<IndexCloseRow[]> {
  const rows = await prisma.indexData.findMany({
    where: { symbol },
    orderBy: { date: 'asc' }
  })
  return rows.map(r => ({ date: r.date, close: Number((r.data as { close?: number }).close) }))
}

/** 基金净值历史 (升序) */
export async function loadFundNavs(code: string): Promise<IndexCloseRow[]> {
  const rows = await prisma.fundNavHistory.findMany({
    where: { code },
    orderBy: { date: 'asc' }
  })
  return rows.map(r => ({ date: r.date, close: r.nav }))
}

/** MA250: 最近 250 条收盘均值; 不足 250 条返回 null */
export function ma250Of(closes: number[]): number | null {
  if (closes.length < 250) return null
  const slice = closes.slice(-250)
  return slice.reduce((a, b) => a + b, 0) / 250
}

// ---------------------------------------------------------------- 定投建议

export interface DcaSuggestion {
  configId: string
  name: string
  target: string
  weekIndex: 1 | 2 | 3 | 4
  currentSplit: number
  bucketLabel: string
  suggestedAmount: number
  unavailable?: string
}

export interface DcaConfigLike {
  id: string
  data: {
    name?: string
    symbol?: string
    weeklySplits?: number[]
    targetFundCode?: string | null
    deletedAt?: string | null
    [k: string]: unknown
  }
}

/**
 * 为用户全部未删除定投配置计算本期建议。
 * 数据缺失 → unavailable 标注, 不中断。
 */
export function buildSuggestions(
  configs: DcaConfigLike[],
  loadData: (symbol: string) => Promise<IndexCloseRow[]>,
  dateISO: string
): Promise<DcaSuggestion[]> {
  return Promise.all(configs.map(async (c) => {
    const name = String(c.data?.name || '未命名配置')
    const splits = c.data?.weeklySplits
    const weekIndex = weekOfMonthOf(dateISO)
    if (!Array.isArray(splits) || splits.length !== 4 || !splits.every(v => Number.isFinite(Number(v)))) {
      return { configId: c.id, name, target: '-', weekIndex, currentSplit: 0, bucketLabel: '', suggestedAmount: 0, unavailable: '定投配置缺少 weeklySplits' }
    }
    const symbol = String(c.data?.symbol || '')
    if (!symbol) {
      return { configId: c.id, name, target: '-', weekIndex, currentSplit: 0, bucketLabel: '', suggestedAmount: 0, unavailable: '定投配置缺少目标标的' }
    }
    let rows: IndexCloseRow[]
    try {
      rows = await loadData(symbol)
    } catch {
      rows = []
    }
    const closes = rows.map(r => r.close).filter(v => Number.isFinite(v) && v > 0)
    const ma250 = ma250Of(closes)
    const lastClose = closes.length > 0 ? closes[closes.length - 1] : NaN
    if (!Number.isFinite(lastClose) || ma250 == null) {
      return {
        configId: c.id, name, target: symbol, weekIndex,
        currentSplit: Math.round(Number(splits[weekIndex - 1])),
        bucketLabel: '', suggestedAmount: 0,
        unavailable: `历史数据不足 (需 250 期, 实际 ${closes.length})`
      }
    }
    const currentSplit = Math.round(Number(splits[weekIndex - 1]))
    const deviation = computeDeviation(lastClose, ma250)
    const bucket = lookupBucket(deviation)
    const suggestedAmount = Math.round(currentSplit * bucket.rate)
    return {
      configId: c.id, name, target: symbol, weekIndex,
      currentSplit, bucketLabel: bucket.label, suggestedAmount
    }
  }))
}

// ---------------------------------------------------------------- 通道

export interface ChannelSummary {
  date: string
  close: number
  mid: number
  top: number
  bottom: number
  posPct: number
  zone: string
  zoneLabel: string
  lowConfidence: boolean
}

/** 上证通道摘要; 月K不足/抓取失败 → null (由调用方标注降级) */
export function buildChannelSummary(bars: MonthlyBar[], close: number | null): ChannelSummary | null {
  if (bars.length < MIN_PIVOTS * 2) return null
  const channel = fitChannel(bars)
  const tNow = bars.length - 1
  const lastClose = close ?? bars[tNow].close
  const info = zoneOf(lastClose, channel, tNow)
  return {
    date: bars[tNow].date,
    close: lastClose,
    mid: Math.round(info.mid * 100) / 100,
    top: Math.round(info.top * 100) / 100,
    bottom: Math.round(info.bottom * 100) / 100,
    posPct: Math.round(info.posPct * 10) / 10,
    zone: info.zone,
    zoneLabel: ZONE_LABELS[info.zone],
    lowConfidence: channel.lowConfidence
  }
}

// ---------------------------------------------------------------- 邮件渲染

export function renderMail(args: {
  dateISO: string
  suggestions: DcaSuggestion[]
  channel: ChannelSummary | null
  channelError?: string
}): { subject: string; html: string; text: string } {
  const { dateISO, suggestions, channel } = args
  const lines: string[] = []
  lines.push(`【长坡】定投策略通知 ${dateISO}`)
  lines.push('')

  // 定投部分
  if (suggestions.length === 0) {
    lines.push('◆ 智能定投: 暂无定投配置')
  } else {
    lines.push('◆ 智能定投建议 (本月第 %d 周)'.replace('%d', String(suggestions[0].weekIndex)))
    for (const s of suggestions) {
      if (s.unavailable) {
        lines.push(`  · ${s.name} [${s.target}]: 数据不可用 (${s.unavailable})`)
      } else {
        lines.push(`  · ${s.name} [${s.target}]: 本周分仓 ${s.currentSplit} 元, ${s.bucketLabel}, 建议投入 ${s.suggestedAmount} 元`)
      }
    }
  }
  lines.push('')

  // 通道部分
  if (channel) {
    lines.push('◆ 上证指数通道')
    lines.push(`  · 收盘 ${channel.close} (${channel.date}${channel.lowConfidence ? ', 仅供参考' : ''})`)
    lines.push(`  · 顶线 ${channel.top} / 中线 ${channel.mid} / 底线 ${channel.bottom}`)
    lines.push(`  · 当前位: 通道内 ${channel.posPct}% (底线 0% ~ 顶线 100%)`)
    lines.push(`  · 今日策略: ${channel.zoneLabel} (${channel.zone})`)
  } else {
    lines.push('◆ 上证指数通道: 数据不可用' + (args.channelError ? ` (${args.channelError})` : ''))
  }

  const text = lines.join('\n')

  const htmlParts: string[] = []
  htmlParts.push('<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">')
  htmlParts.push(`<h2 style="font-size:18px;margin:16px 0 8px">定投策略通知 <span style="color:#6b7280;font-size:13px;font-weight:normal">${dateISO}</span></h2>`)

  htmlParts.push('<h3 style="font-size:14px;margin:12px 0 6px">智能定投建议</h3>')
  if (suggestions.length === 0) {
    htmlParts.push('<p style="font-size:13px;color:#6b7280;margin:4px 0">暂无定投配置</p>')
  } else {
    htmlParts.push('<table style="width:100%;border-collapse:collapse;font-size:13px">')
    htmlParts.push('<tr style="color:#6b7280;text-align:left"><th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">配置</th><th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">本周分仓</th><th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">档位</th><th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">建议投入</th></tr>')
    for (const s of suggestions) {
      const amt = s.unavailable ? `<span style="color:#9ca3af">数据不可用</span>` : `<b>${s.suggestedAmount}</b> 元`
      htmlParts.push(`<tr><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">${s.name}<br><span style="color:#9ca3af;font-size:11px">${s.target}</span></td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">${s.currentSplit} 元</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">${s.bucketLabel || '-'}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">${amt}</td></tr>`)
    }
    htmlParts.push('</table>')
  }

  htmlParts.push('<h3 style="font-size:14px;margin:12px 0 6px">上证指数通道</h3>')
  if (channel) {
    htmlParts.push(`<table style="width:100%;border-collapse:collapse;font-size:13px">`)
    htmlParts.push(`<tr><td style="padding:6px 8px;color:#6b7280;width:88px">收盘</td><td style="padding:6px 8px"><b>${channel.close}</b> <span style="color:#9ca3af;font-size:11px">${channel.date}${channel.lowConfidence ? ' · 仅供参考' : ''}</span></td></tr>`)
    htmlParts.push(`<tr><td style="padding:6px 8px;color:#6b7280">三线</td><td style="padding:6px 8px">顶 ${channel.top} · 中 ${channel.mid} · 底 ${channel.bottom}</td></tr>`)
    htmlParts.push(`<tr><td style="padding:6px 8px;color:#6b7280">当前位</td><td style="padding:6px 8px">通道内 <b>${channel.posPct}%</b> (底线 0% ~ 顶线 100%)</td></tr>`)
    htmlParts.push(`<tr><td style="padding:6px 8px;color:#6b7280">今日策略</td><td style="padding:6px 8px"><b>${channel.zoneLabel}</b> <span style="color:#9ca3af;font-size:11px">${channel.zone}</span></td></tr>`)
    htmlParts.push('</table>')
  } else {
    htmlParts.push(`<p style="font-size:13px;color:#9ca3af;margin:4px 0">数据不可用${args.channelError ? ` (${args.channelError})` : ''}</p>`)
  }

  htmlParts.push('<p style="font-size:11px;color:#9ca3af;margin-top:16px">本邮件由系统自动发送 · 通知设置可在应用「设置 → 通知」中调整</p>')
  htmlParts.push('</div>')

  return {
    subject: `定投策略 ${dateISO} · ${channel ? ZONE_LABELS[channel.zone as keyof typeof ZONE_LABELS] : '数据不可用'}`,
    text,
    html: htmlParts.join('\n')
  }
}

// ---------------------------------------------------------------- 发送管线

export interface SendOutcome {
  userId: string
  email: string
  slot: string
  status: 'sent' | 'failed' | 'skipped'
  error?: string
}

/**
 * 对单个用户执行: 命中槽位 → 构建内容 → 发送 → 记 log + lastSentSlot/failCount。
 * 不命中返回 skipped (不写任何数据)。
 */
export async function processUser(args: {
  userId: string
  accountEmail: string
  cfg: NotifyConfigData
  nowSh: { date: string; time: string; dayOfWeek: number }
  send: (to: string, subject: string, html: string, text: string) => Promise<void>
  loadChannelBars: () => Promise<MonthlyBar[]>
  loadShClose: () => Promise<number | null>
  disabled?: boolean
}): Promise<SendOutcome> {
  const { userId, cfg, nowSh } = args
  const base = { userId, email: cfg.notifyEmail, slot: nowSh.date }
  if (!cfg.enabled || args.disabled) return { ...base, status: 'skipped' }
  const row = await prisma.notificationConfig.findUnique({ where: { userId } })
  const data = (row?.data || {}) as { lastSentSlot?: string | null; failCount?: number }
  if (data.lastSentSlot === nowSh.date) return { ...base, status: 'skipped' }
  if (!shouldFire(cfg, nowSh, data.lastSentSlot || null)) return { ...base, status: 'skipped' }
  if ((data.failCount || 0) >= MAX_RETRY) return { ...base, status: 'skipped', error: '重试次数已用尽' }

  // 内容构建 (各项独立降级)
  const suggestions = await buildUserSuggestions(userId, nowSh.date)
  let channel: ChannelSummary | null = null
  let channelError: string | undefined
  try {
    const bars = await args.loadChannelBars()
    channel = buildChannelSummary(bars, await args.loadShClose().catch(() => null))
    if (!channel) channelError = '月K数据不足'
  } catch (e) {
    channelError = (e as Error).message
  }

  const mail = renderMail({ dateISO: nowSh.date, suggestions, channel, channelError })

  /** 写回发送状态: 重读最新 data 仅合并 lastSentSlot/failCount, 避免用 tick 开始时的旧快照覆盖用户期间的配置修改 */
  async function mergeSendState(fields: { lastSentSlot?: string; failCount?: number }): Promise<void> {
    const latest = await prisma.notificationConfig.findUnique({ where: { userId } })
    const cur = (latest?.data || {}) as Record<string, unknown>
    await prisma.notificationConfig.update({
      where: { userId },
      data: { data: { ...cur, ...fields } }
    })
  }

  try {
    await args.send(cfg.notifyEmail, mail.subject, mail.html, mail.text)
    await prisma.notificationLog.create({ data: { userId, slot: nowSh.date, status: 'sent' } })
    await mergeSendState({ lastSentSlot: nowSh.date, failCount: 0 })
    return { ...base, status: 'sent' }
  } catch (e) {
    const msg = (e as Error).message
    await prisma.notificationLog.create({ data: { userId, slot: nowSh.date, status: 'failed', error: msg } })
    await mergeSendState({ failCount: (data.failCount || 0) + 1 })
    return { ...base, status: 'failed', error: msg }
  }
}

/** 读取用户定投配置 (挂 crud 的 dcaConfigs 资源, data Json) 并计算建议 */
async function buildUserSuggestions(userId: string, dateISO: string): Promise<DcaSuggestion[]> {
  const rows = await prisma.dcaConfig.findMany({ where: { userId, deletedAt: null } })
  return buildSuggestions(
    rows.map(r => ({ id: r.id, data: r.data as DcaConfigLike['data'] })),
    async (symbol) => {
      // 基金标的 (fund:001594, 与前端 FUND_PREFIX 同格式) → fund_nav_history
      const code = symbol.startsWith('fund:') ? symbol.slice(5) : symbol
      if (/^\d{6}$/.test(code)) return loadFundNavs(code)
      // 指数 (^开头) 等走 index_data
      return loadCloses(symbol)
    },
    dateISO
  )
}
