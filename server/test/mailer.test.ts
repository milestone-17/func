/**
 * mailer 加固单测: 全局节流排队 + 535 退避重试 + 非限流错误直抛
 * (mock nodemailer, 不发真实邮件; MAILER_RETRY_MS=20ms 短退避)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- 测试环境: 0 节流 + 20ms 短退避 (vi.hoisted 保证先于模块加载) ----
vi.hoisted(() => {
  process.env.MAILER_THROTTLE_MS = '0'
  process.env.MAILER_RETRY_MS = '20,20,20'
})

// ---- mock nodemailer ----
const sendMailMock = vi.fn()
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock }))
  }
}))

import { setMailerEnv, sendNotificationMail, sendCodeMail, __resetMailerQueueForTest } from '../src/lib/mailer'

const ENV = {
  smtpHost: 'smtp.qq.com',
  smtpPort: 465,
  smtpUser: 'test@qq.com',
  smtpPass: 'secret',
  smtpFrom: 'test@qq.com'
} as any

describe('mailer 节流与重试', () => {
  beforeEach(() => {
    sendMailMock.mockReset()
    __resetMailerQueueForTest()
    setMailerEnv(ENV)
  })

  it('普通发送成功 (1 次即成, 含 html/text 字段)', async () => {
    sendMailMock.mockResolvedValueOnce({})
    await sendNotificationMail('a@qq.com', 's', '<b>x</b>', 'x')
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0][0].to).toBe('a@qq.com')
    expect(sendMailMock.mock.calls[0][0].html).toBe('<b>x</b>')
    expect(sendMailMock.mock.calls[0][0].text).toBe('x')
  })

  it('连续并发发送均成功 (队列串行, 不丢邮件)', async () => {
    sendMailMock.mockResolvedValue({})
    await Promise.all([
      sendNotificationMail('a@qq.com', 's1', 'h', 't'),
      sendNotificationMail('b@qq.com', 's2', 'h', 't'),
      sendNotificationMail('c@qq.com', 's3', 'h', 't')
    ])
    expect(sendMailMock).toHaveBeenCalledTimes(3)
    const tos = sendMailMock.mock.calls.map(c => c[0].to).sort()
    expect(tos).toEqual(['a@qq.com', 'b@qq.com', 'c@qq.com'])
  })

  it('535 限流错误 → 自动退避重试直至成功 (共 3 次尝试)', async () => {
    const rateErr = new Error('Invalid login: 535 Login fail. login frequency limited')
    sendMailMock.mockRejectedValueOnce(rateErr)
    sendMailMock.mockRejectedValueOnce(rateErr)
    sendMailMock.mockResolvedValueOnce({})
    await sendNotificationMail('a@qq.com', 's', 'h', 't')
    expect(sendMailMock).toHaveBeenCalledTimes(3)
  })

  it('持续 535 → 3 次退避后最终抛出 (共 4 次尝试)', async () => {
    const rateErr = new Error('Invalid login: 535 frequency limited')
    sendMailMock.mockRejectedValue(rateErr)
    await expect(sendNotificationMail('a@qq.com', 's', 'h', 't')).rejects.toThrow('535')
    expect(sendMailMock).toHaveBeenCalledTimes(4)
  })

  it('非限流错误 (550 收件人拒绝) → 不重试直接抛', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('550 mailbox not found'))
    await expect(sendNotificationMail('bad@qq.com', 's', 'h', 't')).rejects.toThrow('550')
    expect(sendMailMock).toHaveBeenCalledTimes(1)
  })

  it('前一人失败不阻断队列: 失败后下一个仍能发送', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('550 bad'))
    sendMailMock.mockResolvedValueOnce({})
    await expect(sendNotificationMail('bad@qq.com', 's', 'h', 't')).rejects.toThrow('550')
    await sendNotificationMail('good@qq.com', 's', 'h', 't')
    expect(sendMailMock).toHaveBeenCalledTimes(2)
    expect(sendMailMock.mock.calls[1][0].to).toBe('good@qq.com')
  })

  it('验证码邮件同样走节流出口', async () => {
    sendMailMock.mockResolvedValue({})
    await sendCodeMail(ENV, 'u@qq.com', '123456', 'register')
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0][0].subject).toContain('注册验证码')
  })
})
