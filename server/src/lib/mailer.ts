import nodemailer from 'nodemailer'
import type { Env } from '../env'

let currentEnv: Env | null = null

let transporter: nodemailer.Transporter | null = null

export function getTransporter(env: Env): nodemailer.Transporter {
  if (!transporter) {
    if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
      throw new Error('SMTP 未配置')
    }
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass }
    })
  }
  return transporter
}

export async function sendCodeMail(env: Env, to: string, code: string, purpose: 'register' | 'reset'): Promise<void> {
  const subject = purpose === 'register' ? '【本地财务】注册验证码' : '【本地财务】重置密码验证码'
  const text = `你的验证码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略本邮件。`
  const transporter = getTransporter(env)
  await transporter.sendMail({
    from: `"本地财务" <${env.smtpFrom}>`,
    to,
    subject,
    text
  })
}

/** 发送定投/通道策略通知邮件 (轻量 HTML + 纯文本) */
export async function sendNotificationMail(to: string, subject: string, html: string, text: string): Promise<void> {
  const env = currentEnv
  if (!env) throw new Error('SMTP 未配置')
  const transporter = getTransporter(env)
  await transporter.sendMail({ from: `"本地财务" <${env.smtpFrom}>`, to, subject, text, html })
}

/** 设置邮件 (通知/测试) 的来源环境, 由 app 启动时注入 */
export function setMailerEnv(env: Env): void {
  currentEnv = env
}

/** 发送测试邮件 */
export async function sendTestMail(to: string): Promise<void> {
  if (!currentEnv) throw new Error('SMTP 未配置')
  const transporter = getTransporter(currentEnv)
  await transporter.sendMail({
    from: `"本地财务" <${currentEnv.smtpFrom}>`,
    to,
    subject: '【本地财务】通知邮箱验证',
    text: '这是一封测试邮件, 收到即说明通知邮箱可用。'
  })
}
