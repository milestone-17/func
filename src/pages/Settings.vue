<template>
  <AppShell>
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">设置</h2>

      <section class="bg-white rounded-lg p-4 space-y-3">
        <h3 class="font-semibold">常规</h3>
        <div>
          <label class="text-sm text-gray-500">主题</label>
          <select :value="settings.settings?.theme" @change="onTheme" class="w-full px-3 py-2 border rounded">
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>
        <div>
          <label class="text-sm text-gray-500">USD / CNY 汇率</label>
          <input :value="settings.settings?.usdCnyRate" @change="onRate" type="number" step="0.0001"
            class="w-full px-3 py-2 border rounded" />
        </div>
        <div>
          <label class="text-sm text-gray-500">永久组合偏离阈值 (%)</label>
          <input :value="settings.settings?.permanentThreshold" @change="onThreshold" type="number" step="1"
            class="w-full px-3 py-2 border rounded" />
        </div>
      </section>

      <section class="bg-white rounded-lg p-4 space-y-2">
        <h3 class="font-semibold">数据</h3>
        <button @click="onExport" class="w-full py-2 border rounded">导出备份 (JSON)</button>
        <label class="block w-full py-2 border rounded text-center cursor-pointer">
          导入备份
          <input type="file" accept="application/json" @change="onImport" class="hidden" />
        </label>
        <div v-if="importMsg" class="text-sm" :class="importOk ? 'text-green-600' : 'text-red-500'">{{ importMsg }}</div>
      </section>

      <section class="bg-white rounded-lg p-4 space-y-2">
        <h3 class="font-semibold">关于</h3>
        <p class="text-xs text-gray-500">本地优先 · 不上云 · IndexedDB 存储</p>
        <p class="text-xs text-gray-500">所有数据仅在您的浏览器中</p>
      </section>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import { useSettingsStore } from '@/stores/settings'
import { downloadBackup, importAll, isValidBundle } from '@/lib/backup'
import type { Theme } from '@/types/settings'

const settings = useSettingsStore()
const importMsg = ref('')
const importOk = ref(false)

onMounted(async () => {
  if (!settings.loaded) await settings.load()
})

async function onTheme(e: Event) {
  await settings.save({ theme: (e.target as HTMLSelectElement).value as Theme })
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

function onExport() {
  downloadBackup()
}

async function onImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const bundle = JSON.parse(text)
    if (!isValidBundle(bundle)) throw new Error('备份格式不合法')
    await importAll(bundle, 'merge')
    importOk.value = true
    importMsg.value = '导入成功,请刷新页面'
  } catch (e: any) {
    importOk.value = false
    importMsg.value = '导入失败: ' + (e?.message || '未知错误')
  }
}
</script>
