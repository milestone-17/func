<template>
  <AppShell>
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold tracking-tight">后台管理</h2>
        <Badge tone="red">ADMIN</Badge>
      </div>

      <!-- 统计 -->
      <section class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="card card-pad text-center">
          <p class="text-2xl font-bold tabular-nums">{{ stats?.users.total ?? '—' }}</p>
          <p class="text-xs text-ink3">注册用户</p>
        </div>
        <div class="card card-pad text-center">
          <p class="text-2xl font-bold tabular-nums">{{ stats?.users.activeToday ?? '—' }}</p>
          <p class="text-xs text-ink3">今日活跃</p>
        </div>
        <div class="card card-pad text-center">
          <p class="text-2xl font-bold tabular-nums">{{ stats?.users.guests ?? '—' }}</p>
          <p class="text-xs text-ink3">访客账号</p>
        </div>
        <div class="card card-pad text-center">
          <p class="text-2xl font-bold tabular-nums">{{ stats?.data.transactions ?? '—' }}</p>
          <p class="text-xs text-ink3">交易笔数</p>
        </div>
      </section>

      <!-- 行情同步 -->
      <section class="card card-pad flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">行情数据同步</p>
          <p class="text-xs text-ink3">每日 06:17 (北京时间) 自动抓取; 失败 30 分钟后重试</p>
        </div>
        <button class="rounded-xl bg-surface2 px-3 py-2 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/10" :disabled="syncing" @click="syncMarket">
          {{ syncing ? '同步中...' : '立即同步' }}
        </button>
      </section>
      <p v-if="syncMsg" class="text-xs" :class="syncOk ? 'text-pos' : 'text-neg'">{{ syncMsg }}</p>

      <!-- 用户列表 -->
      <section class="card card-pad space-y-2">
        <span class="section-title mb-1">用户列表 ({{ users.length }})</span>
        <div v-for="u in users" :key="u.id" class="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2.5">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">
              {{ u.email }}
              <Badge v-if="u.role === 'admin'" tone="red" class="ml-1">admin</Badge>
              <Badge v-else-if="u.provider === 'guest'" tone="gray" class="ml-1">访客</Badge>
              <Badge v-else-if="u.provider === 'github'" tone="gray" class="ml-1">GitHub</Badge>
              <Badge v-if="u.disabled" tone="gray" class="ml-1">已禁用</Badge>
            </p>
            <p class="text-[11px] text-ink3">注册 {{ fmtDate(u.createdAt) }}<template v-if="u.lastSeenAt"> · 活跃 {{ fmtDate(u.lastSeenAt) }}</template></p>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <button v-if="!u.disabled && u.role !== 'admin'" class="rounded-lg px-2.5 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" @click="disableUser(u)">禁用</button>
            <button v-if="u.disabled" class="rounded-lg px-2.5 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" @click="enableUser(u)">启用</button>
            <button v-if="u.role !== 'admin'" class="rounded-lg px-2.5 py-1.5 text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" @click="deleteUser(u)">删除</button>
          </div>
        </div>
      </section>

      <p v-if="opMsg" class="text-center text-xs text-ink3">{{ opMsg }}</p>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import Badge from '@/components/Badge.vue'
import { api } from '@/lib/api'

interface AdminUser {
  id: string
  email: string
  provider: string
  role: string
  disabled: boolean
  emailVerified: boolean
  createdAt: string
  lastSeenAt: string | null
  lastImportAt: string | null
}

interface Stats {
  users: { total: number; guests: number; disabled: number; activeToday: number }
  data: { transactions: number; holdings: number; holdingTxns: number; indexRows: number }
}

const users = ref<AdminUser[]>([])
const stats = ref<Stats | null>(null)
const syncing = ref(false)
const syncMsg = ref('')
const syncOk = ref(false)
const opMsg = ref('')

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) } catch { return '—' }
}

async function load(): Promise<void> {
  const [u, s] = await Promise.all([
    api.get<{ items: AdminUser[] }>('/api/admin/users'),
    api.get<Stats>('/api/admin/stats')
  ])
  users.value = u.items
  stats.value = s
}

onMounted(() => { load().catch(() => {}) })

async function syncMarket(): Promise<void> {
  syncing.value = true
  syncMsg.value = ''
  try {
    const r = await api.post<{ ok: boolean; rows: number }>('/api/admin/market/sync')
    syncOk.value = r.ok
    syncMsg.value = r.ok ? `✓ 同步成功, 写入 ${r.rows} 行` : '✗ 未抓到数据, 稍后自动重试'
  } catch (e) {
    syncOk.value = false
    syncMsg.value = (e as Error).message
  } finally {
    syncing.value = false
  }
}

async function disableUser(u: AdminUser): Promise<void> {
  await api.post(`/api/admin/users/${u.id}/disable`)
  opMsg.value = `已禁用 ${u.email}`
  await load()
}
async function enableUser(u: AdminUser): Promise<void> {
  await api.post(`/api/admin/users/${u.id}/enable`)
  opMsg.value = `已启用 ${u.email}`
  await load()
}
async function deleteUser(u: AdminUser): Promise<void> {
  if (!window.confirm(`确定删除 ${u.email}? 其全部数据将被清除, 该操作不可恢复。`)) return
  await api.delete(`/api/admin/users/${u.id}`)
  opMsg.value = `已删除 ${u.email}`
  await load()
}
</script>
