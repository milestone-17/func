/**
 * 邮箱填写提醒逻辑单测: provider × 关闭态 × 已填写 全组合
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  needsEmailPrompt, shouldShowPrompt, dismissForSession, dismissPermanently,
  shouldShowWelcome, markWelcomeSeen, WELCOME_SEEN_KEY,
  DISMISS_SESSION_KEY, DISMISS_PERMANENT_KEY
} from '@/lib/notifyPrompt'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size }
  } as Storage
}

const ss = fakeStorage()
const ls = fakeStorage()

beforeEach(() => {
  ss.clear()
  ls.clear()
})

describe('needsEmailPrompt', () => {
  it('guest provider → true', () => {
    expect(needsEmailPrompt({ email: 'guest-abc@guest.local', provider: 'guest' })).toBe(true)
  })
  it('@guest.local 假邮箱 → true (即使 provider 不是 guest)', () => {
    expect(needsEmailPrompt({ email: 'guest-abc@guest.local', provider: 'email' })).toBe(true)
  })
  it('邮箱注册用户 → false', () => {
    expect(needsEmailPrompt({ email: 'real@example.com', provider: 'email' })).toBe(false)
  })
  it('github 用户有邮箱 → false', () => {
    expect(needsEmailPrompt({ email: 'dev@users.noreply.github.com', provider: 'github' })).toBe(false)
  })
  it('null/undefined → false', () => {
    expect(needsEmailPrompt(null)).toBe(false)
    expect(needsEmailPrompt(undefined)).toBe(false)
  })
  it('空邮箱 + email provider → true (无真实邮箱)', () => {
    expect(needsEmailPrompt({ email: '', provider: 'email' })).toBe(true)
  })
})

describe('shouldShowPrompt', () => {
  const guest = { email: 'guest-x@guest.local', provider: 'guest' }
  const real = { email: 'real@example.com', provider: 'email' }

  it('guest 未关闭 未填写 → 显示', () => {
    expect(shouldShowPrompt({ user: guest, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(true)
  })
  it('guest 已保存通知邮箱 → 不显示', () => {
    expect(shouldShowPrompt({ user: guest, notifyEmailSaved: true, sessionStorage: ss, localStorage: ls })).toBe(false)
  })
  it('guest 永久关闭 → 不显示', () => {
    ls.setItem(DISMISS_PERMANENT_KEY, '1')
    expect(shouldShowPrompt({ user: guest, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
  })
  it('guest 此次关闭 → 不显示', () => {
    ss.setItem(DISMISS_SESSION_KEY, '1')
    expect(shouldShowPrompt({ user: guest, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
  })
  it('guest 此次关闭 + 已填写 → 不显示', () => {
    ss.setItem(DISMISS_SESSION_KEY, '1')
    expect(shouldShowPrompt({ user: guest, notifyEmailSaved: true, sessionStorage: ss, localStorage: ls })).toBe(false)
  })
  it('真实邮箱用户 → 永不显示 (即使什么都没关)', () => {
    expect(shouldShowPrompt({ user: real, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
  })
  it('null 用户 → 不显示', () => {
    expect(shouldShowPrompt({ user: null, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
  })
  it('永久关闭优先于已填写判断 (两者都满足不显示)', () => {
    ls.setItem(DISMISS_PERMANENT_KEY, '1')
    expect(shouldShowPrompt({ user: guest, notifyEmailSaved: true, sessionStorage: ss, localStorage: ls })).toBe(false)
  })
  it('存储抛异常 → 仍显示 (降级策略)', () => {
    const badSS = { getItem: () => { throw new Error('private mode') } }
    expect(shouldShowPrompt({ user: guest, notifyEmailSaved: false, sessionStorage: badSS as unknown as Storage, localStorage: ls })).toBe(true)
  })
})

describe('dismiss 函数', () => {
  it('dismissForSession 写 sessionStorage', () => {
    dismissForSession(ss)
    expect(ss.getItem(DISMISS_SESSION_KEY)).toBe('1')
    expect(ls.getItem(DISMISS_SESSION_KEY)).toBeNull()
  })
  it('dismissPermanently 写 localStorage', () => {
    dismissPermanently(ls)
    expect(ls.getItem(DISMISS_PERMANENT_KEY)).toBe('1')
    expect(ss.getItem(DISMISS_PERMANENT_KEY)).toBeNull()
  })
  it('存储不可用时静默失败不抛', () => {
    const bad = { setItem: () => { throw new Error('full') } }
    expect(() => dismissForSession(bad as unknown as Storage)).not.toThrow()
    expect(() => dismissPermanently(bad as unknown as Storage)).not.toThrow()
  })
})

describe('组合场景模拟', () => {
  const guest = { email: 'guest-x@guest.local', provider: 'guest' }
  const args = (saved: boolean) => ({ user: guest, notifyEmailSaved: saved, sessionStorage: ss, localStorage: ls })

  it('完整生命周期: 显示 → 此次关闭 → 新会话又显示 → 永久关闭 → 永不显示', () => {
    // 第一次进入
    expect(shouldShowPrompt(args(false))).toBe(true)
    // 此次关闭
    dismissForSession(ss)
    expect(shouldShowPrompt(args(false))).toBe(false)
    // 新会话 (清空 sessionStorage)
    ss.clear()
    expect(shouldShowPrompt(args(false))).toBe(true)
    // 永久关闭
    dismissPermanently(ls)
    expect(shouldShowPrompt(args(false))).toBe(false)
    // 即使新会话也不显示
    ss.clear()
    expect(shouldShowPrompt(args(false))).toBe(false)
  })

  it('填邮箱路径: 显示 → 填写保存 → 不再显示 (即使未点任何关闭)', () => {
    expect(shouldShowPrompt(args(false))).toBe(true)
    expect(shouldShowPrompt(args(true))).toBe(false)
  })
})


describe('shouldShowWelcome (邮箱注册首次登录欢迎条)', () => {
  const emailUser = { email: 'real@example.com', provider: 'email' }
  const guestUser = { email: 'guest-x@guest.local', provider: 'guest' }
  const githubUser = { email: 'dev@users.noreply.github.com', provider: 'github' }

  it('邮箱注册 + 未看过 → 显示', () => {
    expect(shouldShowWelcome({ user: emailUser, localStorage: ls })).toBe(true)
  })
  it('已看过 (WELCOME_SEEN_KEY=1) → 不显示', () => {
    ls.setItem(WELCOME_SEEN_KEY, '1')
    expect(shouldShowWelcome({ user: emailUser, localStorage: ls })).toBe(false)
  })
  it('guest → 不显示 (走原填写提醒)', () => {
    expect(shouldShowWelcome({ user: guestUser, localStorage: ls })).toBe(false)
  })
  it('github 登录 → 不显示', () => {
    expect(shouldShowWelcome({ user: githubUser, localStorage: ls })).toBe(false)
  })
  it('provider=email 但 @guest.local 假邮箱 → 不显示', () => {
    expect(shouldShowWelcome({ user: { email: 'g@guest.local', provider: 'email' }, localStorage: ls })).toBe(false)
  })
  it('provider=email 但空邮箱 → 不显示', () => {
    expect(shouldShowWelcome({ user: { email: '', provider: 'email' }, localStorage: ls })).toBe(false)
  })
  it('null/undefined 用户 → 不显示', () => {
    expect(shouldShowWelcome({ user: null, localStorage: ls })).toBe(false)
    expect(shouldShowWelcome({ user: undefined, localStorage: ls })).toBe(false)
  })
  it('存储抛异常 → 显示 (按首次处理)', () => {
    const badLs = { getItem: () => { throw new Error('unavailable') } }
    expect(shouldShowWelcome({ user: emailUser, localStorage: badLs })).toBe(true)
  })
})

describe('markWelcomeSeen', () => {
  it('标记后 shouldShowWelcome → false', () => {
    const emailUser = { email: 'real2@example.com', provider: 'email' }
    expect(shouldShowWelcome({ user: emailUser, localStorage: ls })).toBe(true)
    markWelcomeSeen(ls)
    expect(ls.getItem(WELCOME_SEEN_KEY)).toBe('1')
    expect(shouldShowWelcome({ user: emailUser, localStorage: ls })).toBe(false)
  })
  it('存储抛异常不外溢', () => {
    const badLs = { setItem: () => { throw new Error('unavailable') } }
    expect(() => markWelcomeSeen(badLs)).not.toThrow()
  })
  it('与填写提醒横幅互不干扰: 邮箱用户不触发 needsEmailPrompt', () => {
    const emailUser = { email: 'real3@example.com', provider: 'email' }
    expect(needsEmailPrompt(emailUser)).toBe(false)
    expect(shouldShowPrompt({ user: emailUser, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
  })
})
