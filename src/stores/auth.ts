import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, setUnauthorizedHandler, type CurrentUser } from '@/lib/api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<CurrentUser | null>(null)
  const initialized = ref(false)

  const isLoggedIn = computed(() => user.value !== null)

  /** 启动时探活: 有会话则恢复用户 */
  async function init(): Promise<void> {
    if (initialized.value) return
    initialized.value = true
    try {
      const r = await api.get<{ user: CurrentUser | null }>('/api/me')
      user.value = r.user
    } catch {
      user.value = null
    }
  }

  async function sendCode(email: string, purpose: 'register' | 'reset'): Promise<void> {
    await api.post('/api/auth/send-code', { email, purpose })
  }

  async function register(email: string, password: string, code: string): Promise<void> {
    const r = await api.post<{ user: CurrentUser }>('/api/auth/register', { email, password, code })
    user.value = r.user
  }

  async function login(email: string, password: string): Promise<void> {
    const r = await api.post<{ user: CurrentUser }>('/api/auth/login', { email, password })
    user.value = r.user
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout')
    } finally {
      user.value = null
    }
  }

  async function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    await api.post('/api/auth/reset-password', { email, code, newPassword })
  }

  /** GitHub OAuth 登录入口: 跳转到后端, 由后端重定向 GitHub */
  function githubLogin(): void {
    window.location.href = '/api/auth/github'
  }

  /** 访客体验: 一键创建临时账号并登录 */
  async function guestLogin(): Promise<void> {
    const r = await api.post<{ user: CurrentUser }>('/api/auth/guest')
    user.value = r.user
  }

  /** 注册 401 全局处理 */
  setUnauthorizedHandler(() => {
    user.value = null
  })

  return { user, initialized, isLoggedIn, init, sendCode, register, login, logout, resetPassword, githubLogin, guestLogin }
})
