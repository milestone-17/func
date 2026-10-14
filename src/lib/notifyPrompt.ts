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


// ---------------------------------------------------------------- 邮箱注册用户通知功能介绍/欢迎

export const WELCOME_SEEN_KEY = 'notify-welcome-seen'

/**
 * 是否为邮箱注册的真实邮箱用户 (介绍/欢迎弹窗的目标人群)
 */
function isRealEmailUser(user: PromptUserLike | null | undefined): boolean {
  if (!user) return false
  if (user.provider !== 'email') return false
  const email = (user.email || '').trim()
  return !!email && !/@guest\.local$/i.test(email)
}

/**
 * 邮箱注册 + 通知未开启 → 显示"通知功能介绍"弹窗:
 *   告知有邮件通知能力, 引导去设置开启; 支持此次关闭/永久关闭。
 *   - 永久关闭 / 此次关闭 → 不显示
 *   - 通知已开启 → 不显示 (走 shouldShowWelcome 欢迎弹窗)
 */
export function shouldShowEmailIntro(args: {
  user: PromptUserLike | null | undefined
  notifyEmailSaved: boolean
  sessionStorage?: Pick<Storage, 'getItem'>
  localStorage?: Pick<Storage, 'getItem'>
}): boolean {
  const { user, notifyEmailSaved } = args
  if (!isRealEmailUser(user)) return false
  if (notifyEmailSaved) return false
  const ss = args.sessionStorage ?? globalThis.sessionStorage
  const ls = args.localStorage ?? globalThis.localStorage
  try {
    if (ls?.getItem(DISMISS_PERMANENT_KEY) === '1') return false
    if (ls?.getItem(WELCOME_SEEN_KEY) === '1') return false
    if (ss?.getItem(DISMISS_SESSION_KEY) === '1') return false
  } catch { /* 存储不可用 → 显示 */ }
  return true
}

/**
 * 邮箱注册 + 通知已开启 → 显示"已开启通知"欢迎弹窗 (仅一次, markWelcomeSeen 后不再)。
 * notifyOn=true 前置: 未开启通知的用户属于介绍弹窗的人群, 不得落入欢迎弹窗
 * (否则介绍弹窗被"此次关闭"后, 同一会话内会串场成欢迎弹窗)。
 */
export function shouldShowWelcome(args: {
  user: PromptUserLike | null | undefined
  notifyOn?: boolean
  localStorage?: Pick<Storage, 'getItem'>
}): boolean {
  if (!isRealEmailUser(args.user)) return false
  if (args.notifyOn !== true) return false
  const ls = args.localStorage ?? globalThis.localStorage
  try {
    return ls?.getItem(WELCOME_SEEN_KEY) !== '1'
  } catch {
    return true // 存储不可用 → 显示一次
  }
}

/** 标记欢迎弹窗已看过 (永久) */
export function markWelcomeSeen(ls: Pick<Storage, 'setItem'> = globalThis.localStorage): void {
  try {
    ls?.setItem(WELCOME_SEEN_KEY, '1')
  } catch { /* ignore */ }
}
