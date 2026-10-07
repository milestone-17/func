/**
 * 前端日志采集器
 * - 环形缓冲(默认 500 条), 超出丢弃最旧
 * - localStorage 持久化(跨刷新保留, 方便事后导出)
 * - 分级: info / warn / error
 * - 来源: api 请求错误 / Vue 全局错误 / 未捕获 Promise rejection
 * - 设置页可查看、复制、下载、清空
 */
export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  /** 时间 ISO 字符串 */
  t: string
  /** 级别 */
  lv: LogLevel
  /** 来源: api / vue / unhandled / user / app */
  src: string
  /** 消息 */
  msg: string
  /** 附加详情(错误堆栈/响应片段等) */
  detail?: string
}

const STORE_KEY = 'func_client_logs'
const MAX_ENTRIES = 500

let buffer: LogEntry[] = []

function load(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.slice(-MAX_ENTRIES) : []
  } catch {
    return []
  }
}

function persist(): void {
  try {
    // 只保留最近 MAX_ENTRIES 条, 每次写盘截断
    localStorage.setItem(STORE_KEY, JSON.stringify(buffer.slice(-MAX_ENTRIES)))
  } catch {
    // localStorage 满(隐私模式/配额) → 静默放弃持久化, 内存缓冲仍在
  }
}

buffer = load()

/** 记录一条日志 */
export function logEvent(lv: LogLevel, src: string, msg: string, detail?: string): void {
  buffer.push({ t: new Date().toISOString(), lv, src, msg, detail })
  if (buffer.length > MAX_ENTRIES * 2) buffer = buffer.slice(-MAX_ENTRIES)
  persist()
}

export function getLogs(): LogEntry[] {
  return [...buffer]
}

export function clearLogs(): void {
  buffer = []
  persist()
}

/** 导出为可读文本 */
export function formatLogs(): string {
  const lines = buffer.map((e) => {
    const head = `${e.t} [${e.lv.toUpperCase()}] (${e.src}) ${e.msg}`
    return e.detail ? `${head}\n    ${e.detail.split('\n').join('\n    ')}` : head
  })
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  return [
    `# 长坡 Snowlope 前端日志导出`,
    `# 导出时间: ${new Date().toISOString()}`,
    `# 设备: ${ua}`,
    `# 条数: ${buffer.length}`,
    '',
    ...lines
  ].join('\n')
}

/** 下载 .log 文件 */
export function downloadLogs(): void {
  const blob = new Blob([formatLogs()], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `func-logs-${new Date().toISOString().slice(0, 10)}.log`
  a.click()
  URL.revokeObjectURL(url)
}

/** 全局错误埋点(main.ts 调一次) */
export function installGlobalErrorHooks(): void {
  window.addEventListener('error', (ev) => {
    logEvent('error', 'unhandled', ev.message, ev.error?.stack)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason
    logEvent('error', 'unhandled', r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined)
  })
}
