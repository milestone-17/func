<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

type Mode = 'login' | 'register' | 'reset' | 'guest'
const mode = ref<Mode>('login')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const code = ref('')
const error = ref('')
const loading = ref(false)
const codeSent = ref(false)
const codeCooldown = ref(0)

const title = computed(() => (mode.value === 'login' ? '登录' : mode.value === 'register' ? '注册' : '重置密码'))

// redirect query 由 401 处理器写入, 可能携带部署 base 前缀 (如 /func/xxx)。
// vue-router 会自动叠加 base, 这里归一化为路由内路径, 避免 /func/func/xxx 双前缀。
function redirectPath(): string {
  const raw = (route.query.redirect as string) || '/'
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  if (base && raw.startsWith(base + '/')) return raw.slice(base.length) || '/'
  return raw
}

function switchMode(m: Mode): void {
  mode.value = m
  error.value = ''
  codeSent.value = false
  confirmPassword.value = ''
}

async function sendCode(): Promise<void> {
  if (!email.value || codeCooldown.value > 0) return
  try {
    await auth.sendCode(email.value, mode.value === 'reset' ? 'reset' : 'register')
    codeSent.value = true
    error.value = ''
    codeCooldown.value = 60
    const t = setInterval(() => {
      codeCooldown.value--
      if (codeCooldown.value <= 0) clearInterval(t)
    }, 1000)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function submit(): Promise<void> {
  if (loading.value) return
  error.value = ''
  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  loading.value = true
  try {
    if (mode.value === 'login') {
      await auth.login(email.value, password.value)
    } else if (mode.value === 'register') {
      await auth.register(email.value, password.value, code.value)
    } else {
      await auth.resetPassword(email.value, code.value, password.value)
      switchMode('login')
      error.value = '密码已重置, 请用新密码登录'
      return
    }
    router.push(redirectPath())
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function github(): void {
  const redirect = encodeURIComponent((route.query.redirect as string) || '/')
  window.location.href = `/api/auth/github?redirect=${redirect}`
}

const guestLoading = ref(false)
async function guest(): Promise<void> {
  if (guestLoading.value) return
  guestLoading.value = true
  error.value = ''
  try {
    await auth.guestLogin()
    router.push(redirectPath())
  } catch (e) {
    error.value = (e as Error).message
    guestLoading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1>长坡</h1>

      <!-- 一级菜单: 登录 / 注册 / 访客体验 -->
      <div v-if="mode !== 'reset'" class="tabs">
        <button
          :class="['tab', mode === 'login' ? 'tab-active' : '']"
          @click="switchMode('login')"
        >登录</button>
        <button
          :class="['tab', mode === 'register' ? 'tab-active' : '']"
          @click="switchMode('register')"
        >注册</button>
        <button
          :class="['tab', mode === 'guest' ? 'tab-active' : '']"
          @click="switchMode('guest')"
        >访客体验</button>
      </div>
      <p v-else class="subtitle">重置密码</p>

      <form v-if="mode !== 'guest'" @submit.prevent="submit">
        <label>
          邮箱
          <input v-model="email" type="email" required placeholder="you@example.com" autocomplete="email" />
        </label>

        <label>
          {{ mode === 'reset' ? '新密码' : '密码' }}
          <input
            v-model="password"
            type="password"
            required
            minlength="8"
            placeholder="至少 8 位"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          />
        </label>

        <label v-if="mode === 'register'">
          确认密码
          <input
            v-model="confirmPassword"
            type="password"
            required
            minlength="8"
            placeholder="再输入一次密码"
            autocomplete="new-password"
          />
        </label>

        <label v-if="mode !== 'login'">
          验证码
          <div class="code-row">
            <input v-model="code" required placeholder="6 位验证码" inputmode="numeric" />
            <button type="button" class="btn-secondary" :disabled="codeCooldown > 0 || !email" @click="sendCode">
              {{ codeCooldown > 0 ? `${codeCooldown}s` : '发送验证码' }}
            </button>
          </div>
          <span v-if="codeSent" class="hint">验证码已发送, 请查收邮件 (10 分钟内有效)</span>
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <button type="submit" class="btn-primary" :disabled="loading">
          {{ loading ? '请稍候...' : title }}
        </button>
      </form>

      <template v-if="mode === 'guest'">
        <div class="guest-panel">
          <p class="guest-desc">
            无需注册, 一键创建临时体验账号, 立即试用全部功能。<br />
            体验数据独立保存, 之后可随时退出或注册正式账号。
          </p>
          <button class="btn-primary" :disabled="guestLoading" @click="guest">
            {{ guestLoading ? '正在进入...' : '一键体验' }}
          </button>
          <p v-if="error" class="error">{{ error }}</p>
        </div>
      </template>

      <template v-else-if="mode === 'login'">
        <div class="divider">或</div>
        <button class="btn-github" @click="github">使用 GitHub 登录</button>
        <div class="mode-links">
          <button link @click="switchMode('reset')">忘记密码?</button>
        </div>
      </template>

      <template v-else-if="mode === 'register'">
        <div class="divider">或</div>
        <button class="btn-github" @click="github">使用 GitHub 注册</button>
      </template>

      <div v-else class="mode-links">
        <button link @click="switchMode('login')">返回登录</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg, #f5f5f7);
  padding: 16px;
}
.login-card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
}
@media (min-width: 768px) {
  .login-card {
    max-width: 420px;
    padding: 40px 36px;
  }
}
h1 {
  text-align: center;
  font-size: 22px;
  margin-bottom: 18px;
}
.subtitle {
  text-align: center;
  color: #888;
  font-size: 14px;
  margin-bottom: 20px;
}
.tabs {
  display: flex;
  background: #f2f3f5;
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 20px;
}
.tab {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 9px 0;
  font-size: 14px;
  font-weight: 500;
  color: #888;
  cursor: pointer;
  transition: all 0.15s;
}
.tab-active {
  background: #fff;
  color: #171717;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}
form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #555;
}
input {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 15px;
  outline: none;
}
input:focus {
  border-color: #4f7cff;
}
.code-row {
  display: flex;
  gap: 8px;
}
.code-row input {
  flex: 1;
}
.btn-primary {
  background: #4f7cff;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px;
  font-size: 15px;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.6;
}
.btn-secondary {
  border: 1px solid #4f7cff;
  color: #4f7cff;
  background: #fff;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: #e5484d;
  font-size: 13px;
  margin: 0;
}
.hint {
  color: #999;
  font-size: 12px;
}
.divider {
  text-align: center;
  color: #bbb;
  font-size: 12px;
  margin: 20px 0 12px;
}
.guest-panel {
  margin-top: 8px;
}
.guest-desc {
  color: #888;
  font-size: 13px;
  line-height: 1.7;
  text-align: center;
  margin: 0 0 16px;
}
.btn-github {
  width: 100%;
  background: #24292f;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 11px;
  font-size: 14px;
  cursor: pointer;
}
.mode-links {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 18px;
}
.mode-links button {
  background: none;
  border: none;
  color: #4f7cff;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
</style>
