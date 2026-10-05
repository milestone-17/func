/**
 * 邮箱填写提醒逻辑 (纯函数, 便于测试):
 *   - 需要提醒: guest / @guest.local 假邮箱用户
 *   - 关闭态: 此次关闭 sessionStorage / 永久关闭 localStorage
 *   - 已保存通知邮箱 → 永不提醒
 */

export const DISMISS_SESSION_KEY = 'notify-prompt-dismiss-session'
export const DISMISS_PERMANENT_KEY = 'notify-prompt-dismiss-permanent'

export interface PromptUserLike {
  email: string
  provider: string
}

/** 是否为"无真实邮箱"用户 (guest provider 或 @guest.local 假邮箱或空邮箱) */
export function needsEmailPrompt(user: PromptUserLike | null | undefined): boolean {
  if (!user) return false
  if (user.provider === 'guest') return true
  const email = (user.email || '').trim()
  if (!email) return true
  return /@guest\.local$/i.test(email)
}

/**
 * 是否应显示提醒横幅:
 *   1. 必须是无真实邮箱用户
 *   2. 已保存通知邮箱 → 不显示
 *   3. 永久关闭 → 不显示
 *   4. 此次关闭 (本次会话) → 不显示
 */
export function shouldShowPrompt(args: {
  user: PromptUserLike | null | undefined
  notifyEmailSaved: boolean
  sessionStorage?: Pick<Storage, 'getItem'>
  localStorage?: Pick<Storage, 'getItem'>
}): boolean {
  const { user, notifyEmailSaved } = args
  if (!needsEmailPrompt(user)) return false
  if (notifyEmailSaved) return false
  const ss = args.sessionStorage ?? globalThis.sessionStorage
  const ls = args.localStorage ?? globalThis.localStorage
  try {
    if (ls?.getItem(DISMISS_PERMANENT_KEY) === '1') return false
    if (ss?.getItem(DISMISS_SESSION_KEY) === '1') return false
  } catch { /* 存储不可用 (隐私模式) → 显示 */ }
  return true
}

/** 此次关闭 (sessionStorage, 本会话生效) */
export function dismissForSession(ss: Pick<Storage, 'setItem'> = globalThis.sessionStorage): void {
  try {
    ss?.setItem(DISMISS_SESSION_KEY, '1')
  } catch { /* ignore */ }
}

/** 永久关闭 (localStorage) */
export function dismissPermanently(ls: Pick<Storage, 'setItem'> = globalThis.localStorage): void {
  try {
    ls?.setItem(DISMISS_PERMANENT_KEY, '1')
  } catch { /* ignore */ }
}
