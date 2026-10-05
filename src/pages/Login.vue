<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

type Mode = 'login' | 'register' | 'reset'
const mode = ref<Mode>('login')
const email = ref('')
const password = ref('')
const code = ref('')
const error = ref('')
const loading = ref(false)
const codeSent = ref(false)
const codeCooldown = ref(0)

const title = computed(() => (mode.value === 'login' ? '登录' : mode.value === 'register' ? '注册' : '重置密码'))

function switchMode(m: Mode): void {
  mode.value = m
  error.value = ''
  codeSent.value = false
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
  loading.value = true
  try {
    if (mode.value === 'login') {
      await auth.login(email.value, password.value)
    } else if (mode.value === 'register') {
      await auth.register(email.value, password.value, code.value)
    } else {
      await auth.resetPassword(email.value, code.value, password.value)
      mode.value = 'login'
      error.value = '密码已重置, 请用新密码登录'
      return
    }
    const redirect = (route.query.redirect as string) || '/'
    router.push(redirect)
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
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1>本地财务</h1>
      <p class="subtitle">{{ title }}</p>

      <form @submit.prevent="submit">
        <label>
          邮箱
          <input v-model="email" type="email" required placeholder="you@example.com" autocomplete="email" />
        </label>

        <label>
          密码
          <input
            v-model="password"
            type="password"
            required
            minlength="8"
            placeholder="至少 8 位"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
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

      <div class="divider">或</div>
      <button class="btn-github" @click="github">使用 GitHub 登录</button>

      <div class="mode-links">
        <button v-if="mode !== 'login'" link @click="switchMode('login')">返回登录</button>
        <button v-if="mode === 'login'" link @click="switchMode('register')">没有账号? 注册</button>
        <button v-if="mode === 'login'" link @click="switchMode('reset')">忘记密码?</button>
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
h1 {
  text-align: center;
  font-size: 22px;
  margin-bottom: 4px;
}
.subtitle {
  text-align: center;
  color: #888;
  font-size: 14px;
  margin-bottom: 24px;
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
