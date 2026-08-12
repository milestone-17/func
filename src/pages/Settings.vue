<template>
  <AppShell>
    <div class="space-y-4">
      <h2 class="text-lg font-bold tracking-tight">设置</h2>

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

      <!-- 应用锁 -->
      <AppLockSettings />

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
      </section>

      <!-- 数据 -->
      <section class="card card-pad space-y-2">
        <span class="section-title mb-1">数据管理</span>
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
        <p class="text-xs text-ink3">本地优先 · 不上云 · IndexedDB 存储</p>
        <p class="text-xs text-ink3">所有数据仅保存在你的浏览器中,清除浏览器数据将丢失</p>
        <p class="text-xs text-ink3">建议定期导出备份</p>
      </section>

      <p class="text-center text-[11px] text-ink3 pt-2">本地财务 v1.0</p>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import AppLockSettings from '@/components/AppLockSettings.vue'
import { useSettingsStore } from '@/stores/settings'
import { downloadBackup, importAll, isValidBundle } from '@/lib/backup'
import type { Theme } from '@/types/settings'

const settings = useSettingsStore()
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

function onExport() { downloadBackup() }

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
