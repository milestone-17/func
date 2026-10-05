<template>
  <AppShell>
    <div class="space-y-4">
      <h2 class="text-lg font-bold tracking-tight">设置</h2>

      <!-- 账号 -->
      <section class="card card-pad space-y-3">
        <span class="section-title">账号</span>
        <div class="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-xs">
          <span class="text-ink2">当前用户</span>
          <span class="text-ink font-medium">{{ auth.user?.email || '未登录' }}</span>
        </div>
        <button @click="onLogout" class="w-full rounded-xl bg-rose-50 py-2.5 text-sm font-medium text-neg transition hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20">
          退出登录
        </button>
      </section>

      <!-- 外观 -->
      <section class="card card-pad space-y-3">
        <span class="section-title">外观</span>
        <div>
          <label class="label">主题</label>
          <div class="flex rounded-xl bg-surface2 p-1">
            <button v-for="opt in themeOptions" :key="opt.value" @click="setTheme(opt.value)"
              :class="['flex-1 rounded-lg py-2 text-sm font-medium transition flex items-center justify-center gap-1.5',
                (settings.settings?.theme ?? 'system') === opt.value ? 'bg-surface text-ink shadow-sm' : 'text-ink3']">
              <span>{{ opt.icon }}</span>{{ opt.label }}
            </button>
          </div>
        </div>
      </section>

      <!-- 财务参数 -->
      <section class="card card-pad space-y-3">
        <span class="section-title">财务参数</span>
        <div>
          <label class="label">USD / CNY 汇率</label>
          <input :value="settings.settings?.usdCnyRate" @change="onRate" type="number" step="0.0001" class="input money" />
          <p class="mt-1 text-[11px] text-ink3">用于美股持仓折算人民币市值</p>
        </div>
        <div>
          <label class="label">永久组合偏离阈值 (%)</label>
          <input :value="settings.settings?.permanentThreshold" @change="onThreshold" type="number" step="1" class="input money" />
          <p class="mt-1 text-[11px] text-ink3">偏离目标超过此值时提醒再平衡</p>
        </div>
        <div>
          <label class="label">备份提醒阈值 (天)</label>
          <input :value="settings.settings?.backupReminderDays ?? 30" @change="onReminderDays" type="number" min="7" max="180" step="1" class="input money" />
          <p class="mt-1 text-[11px] text-ink3">超过这么多天未备份,总览页会提醒你 (7–180)</p>
        </div>
      </section>

      <!-- 数据 -->
      <section class="card card-pad space-y-2">
        <span class="section-title mb-1">数据管理</span>
        <div class="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-xs">
          <span class="text-ink2">数据存储</span>
          <Badge tone="green">云端 PostgreSQL</Badge>
        </div>
        <div class="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-xs">
          <span class="text-ink2">最近备份</span>
          <span class="money text-ink">{{ lastBackupLabel }}</span>
        </div>
        <button @click="onExport" class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition hover:bg-surface2">
          <span class="flex items-center gap-2 text-ink">
            <svg class="h-4 w-4 text-ink2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出备份
          </span>
          <svg class="h-4 w-4 text-ink3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <label class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition hover:bg-surface2 cursor-pointer">
          <span class="flex items-center gap-2 text-ink">
            <svg class="h-4 w-4 text-ink2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            导入备份
          </span>
          <svg class="h-4 w-4 text-ink3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          <input type="file" accept="application/json" @change="onImport" class="hidden" />
        </label>
        <div v-if="importMsg" class="rounded-lg px-3 py-2 text-sm" :class="importOk ? 'bg-emerald-50 text-pos dark:bg-emerald-500/10' : 'bg-rose-50 text-neg dark:bg-rose-500/10'">{{ importMsg }}</div>
      </section>

      <!-- 关于 -->
      <section class="card card-pad space-y-1.5">
        <span class="section-title mb-1">关于</span>
        <p class="text-xs text-ink3">多端同步 · 云端存储 · 数据按账号隔离</p>
        <p class="text-xs text-ink3">服务器每日自动备份, 保留 7 天</p>
        <p class="text-xs text-ink3">仍可导出 JSON 备份文件到本地</p>
      </section>

      <p class="text-center text-[11px] text-ink3 pt-2">本地财务 v2.0 · 云端版</p>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import Badge from '@/components/Badge.vue'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { downloadBackup, importAll, isValidBundle } from '@/lib/backup'
import type { Theme } from '@/types/settings'

const settings = useSettingsStore()
const auth = useAuthStore()
const router = useRouter()
const importMsg = ref('')
const importOk = ref(false)

const themeOptions = [
  { value: 'light' as Theme, label: '浅色', icon: '☀️' },
  { value: 'dark' as Theme, label: '深色', icon: '🌙' },
  { value: 'system' as Theme, label: '跟随系统', icon: '🖥️' }
]

onMounted(async () => { if (!settings.loaded) await settings.load() })

async function setTheme(t: Theme) {
  await settings.save({ theme: t })
  applyTheme()
}
function applyTheme() {
  const t = settings.settings?.theme
  if (t === 'dark') document.documentElement.classList.add('dark')
  else if (t === 'light') document.documentElement.classList.remove('dark')
  else document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)
}
async function onRate(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v) && v > 0) await settings.save({ usdCnyRate: v })
}
async function onThreshold(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v) && v > 0) await settings.save({ permanentThreshold: v })
}
async function onReminderDays(e: Event) {
  let v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  v = Math.max(7, Math.min(180, Math.round(v)))
  await settings.save({ backupReminderDays: v })
}

async function onLogout() {
  await auth.logout()
  router.push({ name: 'login' })
}

const lastBackupLabel = computed(() => {
  const t = settings.settings?.lastBackupAt
  if (!t) return '从未备份'
  try { return new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) }
  catch { return '—' }
})

function onExport() { downloadBackup(); setTimeout(() => settings.load(), 600) }

async function onImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const bundle = JSON.parse(text)
    if (!isValidBundle(bundle)) throw new Error('备份格式不合法')
    await importAll(bundle, 'merge')
    importOk.value = true
    importMsg.value = '✓ 导入成功,请刷新页面'
  } catch (e: any) {
    importOk.value = false
    importMsg.value = '导入失败: ' + (e?.message || '未知错误')
  }
}
</script>
