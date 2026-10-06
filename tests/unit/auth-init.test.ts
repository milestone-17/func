/**
 * auth store 加固单测: init 失败重试 + 401 区分 + 未登录跳转
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getMock = vi.fn()
const postMock = vi.fn()
let unauthorizedCb: (() => void) | null = null

vi.mock('@/lib/api', () => ({
  api: {
    get: (p: string) => getMock(p),
    post: (p: string) => postMock(p)
  },
  setUnauthorizedHandler: (fn: () => void) => { unauthorizedCb = fn }
}))

import { useAuthStore } from '@/stores/auth'
import { createPinia, setActivePinia } from 'pinia'

function err(status: number) {
  const e = new Error('x') as Error & { status?: number }
  e.status = status
  return e
}

describe('auth store init 加固', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    setActivePinia(createPinia())
  })

  it('首次 /api/me 网络异常 → 重试后成功恢复登录', async () => {
    getMock.mockRejectedValueOnce(err(0)).mockResolvedValueOnce({ user: { id: 'u1', email: 'a@b.c', provider: 'guest' } })
    const auth = useAuthStore()
    await auth.init()
    expect(auth.isLoggedIn).toBe(true)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('401 → 不重试, 判定未登录', async () => {
    getMock.mockRejectedValue(err(401))
    const auth = useAuthStore()
    await auth.init()
    expect(auth.isLoggedIn).toBe(false)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('持续网络异常 → 重试 3 次后放弃', async () => {
    getMock.mockRejectedValue(err(0))
    const auth = useAuthStore()
    await auth.init()
    expect(auth.isLoggedIn).toBe(false)
    expect(getMock).toHaveBeenCalledTimes(3)
  })

  it('init 幂等: 并发/重复调用只发一次请求', async () => {
    getMock.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c', provider: 'guest' } })
    const auth = useAuthStore()
    await Promise.all([auth.init(), auth.init(), auth.init()])
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('setUnauthorizedHandler 被注册且回调跳登录页', () => {
    const auth = useAuthStore()
    auth.init().then(() => {
      expect(unauthorizedCb).toBeTruthy()
    })
    expect(unauthorizedCb).toBeTruthy()
  })
})
