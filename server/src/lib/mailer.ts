import nodemailer from 'nodemailer'
import type { Env } from '../env'

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
