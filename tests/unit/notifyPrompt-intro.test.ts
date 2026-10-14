import { describe, it, expect, beforeEach } from 'vitest'
import {
  shouldShowEmailIntro, shouldShowWelcome, markWelcomeSeen,
  dismissForSession, dismissPermanently,
  DISMISS_SESSION_KEY
} from '../../src/lib/notifyPrompt'

function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size }
  }
}

const emailUser = { email: 'u@test.com', provider: 'email' }

describe('shouldShowEmailIntro (邮箱注册未开启通知 → 介绍弹窗)', () => {
  let ss: ReturnType<typeof fakeStorage>
  let ls: ReturnType<typeof fakeStorage>
  beforeEach(() => { ss = fakeStorage(); ls = fakeStorage() })

  it('未开启通知且无关闭记录 → 显示', () => {
    expect(shouldShowEmailIntro({ user: emailUser, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(true)
  })

  it('通知已开启 → 不显示 (走欢迎弹窗)', () => {
    expect(shouldShowEmailIntro({ user: emailUser, notifyEmailSaved: true, sessionStorage: ss, localStorage: ls })).toBe(false)
  })

  it('此次关闭 → 本会话不显示, 新会话恢复', () => {
    dismissForSession(ss)
    expect(shouldShowEmailIntro({ user: emailUser, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
    ss.removeItem(DISMISS_SESSION_KEY)
    expect(shouldShowEmailIntro({ user: emailUser, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(true)
  })

  it('永久关闭 → 不显示', () => {
    dismissPermanently(ls)
    expect(shouldShowEmailIntro({ user: emailUser, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
  })

  it('永久关闭 + seen 联动 (Banner dismissIntroForever 组合) → 欢迎弹窗也不再出现', () => {
    dismissPermanently(ls)
    markWelcomeSeen(ls)
    expect(shouldShowWelcome({ user: emailUser, notifyOn: true, localStorage: ls })).toBe(false)
  })

  it('guest / github 用户不显示', () => {
    expect(shouldShowEmailIntro({ user: { email: 'g@guest.local', provider: 'guest' }, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
    expect(shouldShowEmailIntro({ user: { email: 'x@y.com', provider: 'github' }, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
  })
})

describe('shouldShowWelcome (邮箱注册已开启通知 → 欢迎弹窗)', () => {
  let ss: ReturnType<typeof fakeStorage>
  let ls: ReturnType<typeof fakeStorage>
  beforeEach(() => { ss = fakeStorage(); ls = fakeStorage() })

  it('已开启 + 未看过 → 显示', () => {
    expect(shouldShowWelcome({ user: emailUser, notifyOn: true, localStorage: ls })).toBe(true)
  })

  it('notifyOn 前置: 未开启通知的用户不落入欢迎弹窗 (防串场)', () => {
    expect(shouldShowWelcome({ user: emailUser, notifyOn: false, localStorage: ls })).toBe(false)
    expect(shouldShowWelcome({ user: emailUser, localStorage: ls })).toBe(false)
  })

  it('markWelcomeSeen 后不再显示', () => {
    markWelcomeSeen(ls)
    expect(shouldShowWelcome({ user: emailUser, notifyOn: true, localStorage: ls })).toBe(false)
  })

  it('完整生命周期: 未开启→介绍→开启→欢迎→seen', () => {
    // 1. 未开启: 介绍弹窗适用, 欢迎不适用
    expect(shouldShowEmailIntro({ user: emailUser, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(true)
    expect(shouldShowWelcome({ user: emailUser, notifyOn: false, localStorage: ls })).toBe(false)
    // 2. 此次关闭介绍弹窗
    dismissForSession(ss)
    expect(shouldShowEmailIntro({ user: emailUser, notifyEmailSaved: false, sessionStorage: ss, localStorage: ls })).toBe(false)
    // 同一会话内也不串场到欢迎弹窗
    expect(shouldShowWelcome({ user: emailUser, notifyOn: false, localStorage: ls })).toBe(false)
    // 3. 用户开启通知
    expect(shouldShowWelcome({ user: emailUser, notifyOn: true, localStorage: ls })).toBe(true)
    // 4. 看过欢迎
    markWelcomeSeen(ls)
    expect(shouldShowWelcome({ user: emailUser, notifyOn: true, localStorage: ls })).toBe(false)
  })
})
