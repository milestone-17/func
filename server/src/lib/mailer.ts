/**
 * SMTP 邮件发送 (QQ 邮箱兼容加固):
 *   - 连接池复用 (避免每封邮件重新 LOGIN 触发 535 登录频率限制)
 *   - 全局发送节流 (最小间隔, 排队发送)
 *   - 535/限流错误自动退避重试 (30s → 60s → 120s)
 */
import nodemailer from 'nodemailer'
import type { Env } from '../env'

let currentEnv: Env | null = null

let transporter: nodemailer.Transporter | null = null

/** 全局发送节流: 两次发送最小间隔 (ms)。QQ 邮箱保守取 3s, 上线每用户日一封完全无感 */
const SEND_INTERVAL_MS = Number(process.env.MAILER_THROTTLE_MS ?? 3000)
let lastSendAt = 0
let sendQueue: Promise<void> = Promise.resolve()

/** 535/限流退避重试参数 */
const RETRY_DELAYS_MS = (process.env.MAILER_RETRY_MS ?? '30000,60000,120000').split(',').map(Number)

function isRateLimitError(e: unknown): boolean {
  const msg = String((e as Error)?.message || '') + String((e as { response?: string })?.response || '')
  return /535|frequency limited|rate limit|too many/i.test(msg)
}

export function getTransporter(env: Env): nodemailer.Transporter {
  if (!transporter) {
    if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
      throw new Error('SMTP 未配置')
    }
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
      // 连接池: 复用 SMTP 连接, 批量发送不再逐封重新登录
      pool: true,
      maxConnections: 1,
      maxMessages: 100
    })
  }
  return transporter
}

/** 全局排队 + 节流的底层发送 (所有邮件都经此出口) */
function throttledSend(env: Env, mail: nodemailer.SendMailOptions): Promise<void> {
  const run = async (): Promise<void> => {
    const wait = lastSendAt + SEND_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    let lastErr: unknown
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        await getTransporter(env).sendMail(mail)
        lastSendAt = Date.now()
        return
      } catch (e) {
        lastErr = e
        // 仅限流错误退避重试; 其他错误 (收件人无效等) 直接抛出
        if (attempt < RETRY_DELAYS_MS.length && isRateLimitError(e)) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
          continue
        }
        throw e
      }
    }
    throw lastErr
  }
  // 串行排队, 避免并发触发限流
  const p = sendQueue.then(run, run)
  sendQueue = p.catch(() => { /* 队列吞错, 防止断链 */ })
  return p
}

export async function sendCodeMail(env: Env, to: string, code: string, purpose: 'register' | 'reset'): Promise<void> {
  const subject = purpose === 'register' ? '【长坡】注册验证码' : '【长坡】重置密码验证码'
  const text = `你的验证码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略本邮件。`
  await throttledSend(env, {
    from: `"长坡 Snowlope" <${env.smtpFrom}>`,
    to,
    subject,
    text
  })
}

/** 发送定投/通道策略通知邮件 (轻量 HTML + 纯文本) */
export async function sendNotificationMail(to: string, subject: string, html: string, text: string): Promise<void> {
  const env = currentEnv
  if (!env) throw new Error('SMTP 未配置')
  await throttledSend(env, { from: `"长坡 Snowlope" <${env.smtpFrom}>`, to, subject, text, html })
}

/** 设置邮件 (通知/测试) 的来源环境, 由 app 启动时注入 */
export function setMailerEnv(env: Env): void {
  currentEnv = env
}

/** 仅测试用: 重置节流时间戳与发送队列 (模块级状态隔离) */
export function __resetMailerQueueForTest(): void {
  lastSendAt = 0
  sendQueue = Promise.resolve()
}

/** 发送测试邮件 */
export async function sendTestMail(to: string): Promise<void> {
  if (!currentEnv) throw new Error('SMTP 未配置')
  await throttledSend(currentEnv, {
    from: `"长坡 Snowlope" <${currentEnv.smtpFrom}>`,
    to,
    subject: '【长坡】通知邮箱验证',
    text: '这是一封测试邮件, 收到即说明通知邮箱可用。'
  })
}
