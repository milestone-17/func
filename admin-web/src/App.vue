<template>
  <!-- 登录页 -->
  <div v-if="!authed" class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <h1 class="login-title">Func 管理后台</h1>
      <p class="login-sub">仅限管理员使用</p>
      <form @submit.prevent="doLogin">
        <label class="label">管理员邮箱</label>
        <input v-model="email" type="email" class="input" placeholder="admin@example.com" autocomplete="username" />
        <label class="label" style="margin-top:14px">密码</label>
        <input v-model="password" type="password" class="input" placeholder="••••••••" autocomplete="current-password" />
        <div v-if="loginErr" class="login-err">{{ loginErr }}</div>
        <button type="submit" class="btn-primary" style="width:100%;margin-top:18px;padding:10px" :disabled="logging">
          {{ logging ? '登录中…' : '登录' }}
        </button>
      </form>
    </div>
  </div>

  <!-- 主布局 -->
  <div v-else class="layout">
    <aside class="sidebar">
      <div class="side-brand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <span>Func Admin</span>
      </div>
      <nav class="side-nav">
        <button v-for="v in views" :key="v.id" :class="['nav-item', view === v.id ? 'active' : '']" @click="switchView(v.id)">
          <span v-html="v.icon"></span>{{ v.label }}
        </button>
      </nav>
      <div class="side-foot">
        <div class="side-user">{{ adminEmail }}</div>
        <button class="btn-sm btn" style="background:transparent;border-color:#334155;color:#94a3b8" @click="doLogout">退出</button>
      </div>
    </aside>

    <main class="content">
      <!-- 仪表盘 -->
      <section v-if="view === 'dashboard'">
        <h1 class="page-title">仪表盘</h1>
        <p class="page-sub">全站运行概览 · 数据更新于 {{ fmtTime(summaryFetchedAt) }}</p>
        <div v-if="dashLoading" class="empty">加载中…</div>
        <template v-else-if="summary">
          <div class="stat-grid">
            <div class="card stat-card"><div class="stat-label">注册用户</div><div class="stat-value">{{ summary.users.total }}</div></div>
            <div class="card stat-card"><div class="stat-label">今日活跃</div><div class="stat-value" style="color:var(--pos)">{{ summary.users.activeToday }}</div></div>
            <div class="card stat-card"><div class="stat-label">访客用户</div><div class="stat-value">{{ summary.users.guests }}</div></div>
            <div class="card stat-card"><div class="stat-label">已禁用</div><div class="stat-value" style="color:var(--neg)">{{ summary.users.disabled }}</div></div>
            <div class="card stat-card"><div class="stat-label">交易记录</div><div class="stat-value">{{ summary.data.transactions }}</div></div>
            <div class="card stat-card"><div class="stat-label">持仓</div><div class="stat-value">{{ summary.data.holdings }}</div></div>
            <div class="card stat-card"><div class="stat-label">指数K线行数</div><div class="stat-value">{{ summary.data.indexRows }}</div></div>
            <div class="card stat-card"><div class="stat-label">基金净值行数</div><div class="stat-value">{{ summary.data.fundHistRows }}</div></div>
          </div>
          <div class="card" style="margin-top:14px">
            <div class="toolbar" style="margin-bottom:8px">
              <div>
                <div class="stat-label">行情状态</div>
                <div style="margin-top:4px">
                  最新数据日期 <b>{{ summary.market.latestDate || '—' }}</b>
                  <span v-if="summary.market.latestSource" class="badge badge-blue" style="margin-left:8px">来源: {{ summary.market.latestSource }}</span>
                  <span v-if="marketStale" class="badge badge-red" style="margin-left:8px">已滞后 24h+</span>
                </div>
              </div>
              <button class="btn-primary" :disabled="syncing" @click="syncMarket">
                {{ syncing ? '同步中…' : '立即同步行情' }}
              </button>
            </div>
            <div class="stat-label">当前源优先级</div>
            <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
              <span v-for="(s, i) in summary.market.sourcePriority" :key="s" class="badge badge-gray">
                {{ i + 1 }}. {{ s }}
              </span>
            </div>
          </div>
        </template>
      </section>

      <!-- 用户管理 -->
      <section v-if="view === 'users'">
        <h1 class="page-title">用户管理</h1>
        <p class="page-sub">共 {{ users.length }} 个用户</p>
        <div class="toolbar">
          <input v-model="userFilter" class="input" style="max-width:280px" placeholder="搜索邮箱…" />
          <button class="btn" @click="loadUsers">刷新</button>
        </div>
        <div class="card" style="padding:0;overflow-x:auto">
          <table class="tbl">
            <thead>
              <tr><th>邮箱</th><th>方式</th><th>角色</th><th>状态</th><th>注册时间</th><th>最近活跃</th><th style="text-align:right">操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="u in filteredUsers" :key="u.id">
                <td>{{ u.email }}</td>
                <td><span class="badge badge-gray">{{ u.provider }}</span></td>
                <td><span v-if="u.role === 'admin'" class="badge badge-blue">admin</span><span v-else>—</span></td>
                <td>
                  <span v-if="u.disabled" class="badge badge-red">已禁用</span>
                  <span v-else class="badge badge-green">正常</span>
                </td>
                <td>{{ fmtTime(u.createdAt) }}</td>
                <td>{{ fmtTime(u.lastSeenAt) }}</td>
                <td style="text-align:right;white-space:nowrap">
                  <template v-if="u.role !== 'admin'">
                    <button class="btn-sm btn" @click="toggleUser(u)">{{ u.disabled ? '启用' : '禁用' }}</button>
                    <button class="btn-sm btn-danger" style="margin-left:6px" @click="removeUser(u)">删除</button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="filteredUsers.length === 0" class="empty">无匹配用户</div>
        </div>
      </section>

      <!-- 行情源管理 -->
      <section v-if="view === 'sources'">
        <h1 class="page-title">行情源管理</h1>
        <p class="page-sub">拖动顺序按钮调整优先级, 数字越小越优先; 失败自动降级到下一源</p>
        <div class="card" style="max-width:560px">
          <div v-for="(s, i) in priorityDraft" :key="s" class="source-row">
            <span class="source-idx">{{ i + 1 }}</span>
            <span class="source-name">{{ sourceLabel(s) }}</span>
            <span style="flex:1"></span>
            <button class="btn-sm btn" :disabled="i === 0" @click="movePriority(i, -1)">↑</button>
            <button class="btn-sm btn" :disabled="i === priorityDraft.length - 1" @click="movePriority(i, 1)">↓</button>
          </div>
          <button class="btn-primary" style="margin-top:14px" :disabled="!priorityDirty || savingPriority" @click="savePriority">
            {{ savingPriority ? '保存中…' : '保存优先级' }}
          </button>
          <span v-if="!priorityDirty" style="margin-left:10px;font-size:12px;color:var(--ink3)">未修改</span>
        </div>
      </section>

      <!-- 基金池 -->
      <section v-if="view === 'funds'">
        <h1 class="page-title">定投基金池</h1>
        <p class="page-sub">全站用户添加过的定投基金 (去重) 及其净值历史覆盖</p>
        <div class="toolbar">
          <span style="font-size:13px;color:var(--ink2)">共 {{ fundPool.length }} 只</span>
          <button class="btn" @click="loadFundPool">刷新</button>
        </div>
        <div class="card" style="padding:0">
          <table class="tbl">
            <thead><tr><th>代码</th><th>名称</th><th>净值行数</th><th>加入时间</th><th style="text-align:right">操作</th></tr></thead>
            <tbody>
              <tr v-for="f in fundPool" :key="f.code">
                <td><b>{{ f.code }}</b></td>
                <td>{{ f.name }}</td>
                <td>
                  <span :class="['badge', f.histRows >= 500 ? 'badge-green' : f.histRows >= 100 ? 'badge-amber' : 'badge-red']">
                    {{ f.histRows }} 条
                  </span>
                </td>
                <td>{{ fmtTime(f.createdAt) }}</td>
                <td style="text-align:right">
                  <button class="btn-sm btn-danger" @click="removeFund(f)">移除</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="fundPool.length === 0" class="empty">暂无基金</div>
        </div>
      </section>

      <!-- 审计日志 -->
      <section v-if="view === 'audit'">
        <h1 class="page-title">审计日志</h1>
        <p class="page-sub">后台敏感操作记录</p>
        <div class="toolbar">
          <span style="font-size:13px;color:var(--ink2)">最近 {{ auditItems.length }} 条</span>
          <button class="btn" @click="loadAudit">刷新</button>
        </div>
        <div class="card" style="padding:0">
          <table class="tbl">
            <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr></thead>
            <tbody>
              <tr v-for="a in auditItems" :key="a.id">
                <td style="white-space:nowrap">{{ fmtTime(a.createdAt) }}</td>
                <td>{{ a.actor }}</td>
                <td><span class="badge badge-blue">{{ actionLabel(a.action) }}</span></td>
                <td>{{ a.target || '—' }}</td>
                <td style="font-size:12px;color:var(--ink2)">{{ a.detail ? JSON.stringify(a.detail) : '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="auditItems.length === 0" class="empty">暂无记录</div>
        </div>
      </section>
    </main>
  </div>

  <div v-if="toast" :class="['toast', toastOk ? 'toast-ok' : 'toast-err']">{{ toast }}</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { adminApi, fmtTime, type PanelSummary, type PanelUser, type AuditItem, type FundPoolItem } from './api'

type ViewId = 'dashboard' | 'users' | 'sources' | 'funds' | 'audit'

const views: Array<{ id: ViewId; label: string; icon: string }> = [
  { id: 'dashboard', label: '仪表盘', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>' },
  { id: 'users', label: '用户管理', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { id: 'sources', label: '行情源', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' },
  { id: 'funds', label: '基金池', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' },
  { id: 'audit', label: '审计日志', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' }
]

const authed = ref(false)
const adminEmail = ref('')
const email = ref('')
const password = ref('')
const loginErr = ref('')
const logging = ref(false)
const view = ref<ViewId>('dashboard')

const summary = ref<PanelSummary | null>(null)
const summaryFetchedAt = ref<Date | null>(null)
const dashLoading = ref(false)
const syncing = ref(false)

const users = ref<PanelUser[]>([])
const userFilter = ref('')
const auditItems = ref<AuditItem[]>([])
const fundPool = ref<FundPoolItem[]>([])

const priorityDraft = ref<string[]>([])
const savedPriority = ref<string[]>([])
const savingPriority = ref(false)
const priorityDirty = computed(() => JSON.stringify(priorityDraft.value) !== JSON.stringify(savedPriority.value))

const toast = ref('')
const toastOk = ref(true)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, ok = true) {
  toast.value = msg
  toastOk.value = ok
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 3000)
}

const SOURCE_NAMES: Record<string, string> = {
  tencent: '腾讯行情',
  eastmoney: '东方财富',
  yahoo: 'Yahoo'
}
function sourceLabel(id: string): string {
  return SOURCE_NAMES[id] ?? id
}
const ACTION_NAMES: Record<string, string> = {
  login: '登录',
  logout: '退出',
  set_source_priority: '调整源优先级',
  sync_market: '手动同步行情',
  disable_user: '禁用用户',
  enable_user: '启用用户',
  delete_user: '删除用户',
  remove_fund_pool: '移除基金'
}
function actionLabel(a: string): string {
  return ACTION_NAMES[a] ?? a
}

const marketStale = computed(() => {
  const d = summary.value?.market.latestDate
  if (!d) return true
  return (Date.now() - new Date(`${d}T00:00:00`).getTime()) > 36 * 3600 * 1000
})

const filteredUsers = computed(() => {
  const k = userFilter.value.trim().toLowerCase()
  if (!k) return users.value
  return users.value.filter(u => u.email.toLowerCase().includes(k))
})

async function doLogin() {
  loginErr.value = ''
  logging.value = true
  try {
    await adminApi.login(email.value.trim(), password.value)
    adminEmail.value = email.value.trim()
    authed.value = true
    await loadDashboard()
  } catch (e) {
    loginErr.value = (e as Error).message
  } finally {
    logging.value = false
  }
}

async function doLogout() {
  try { await adminApi.logout() } catch { /* ignore */ }
  authed.value = false
  password.value = ''
}

function switchView(v: ViewId) {
  view.value = v
  if (v === 'dashboard') loadDashboard()
  else if (v === 'users') loadUsers()
  else if (v === 'sources') initPriority()
  else if (v === 'funds') loadFundPool()
  else if (v === 'audit') loadAudit()
}

async function loadDashboard() {
  dashLoading.value = true
  try {
    summary.value = await adminApi.summary()
    summaryFetchedAt.value = new Date()
    savedPriority.value = [...summary.value.market.sourcePriority]
    priorityDraft.value = [...summary.value.market.sourcePriority]
  } catch (e) {
    showToast((e as Error).message, false)
  } finally {
    dashLoading.value = false
  }
}

async function loadUsers() {
  try {
    users.value = (await adminApi.users()).items
  } catch (e) {
    showToast((e as Error).message, false)
  }
}

async function loadAudit() {
  try {
    auditItems.value = (await adminApi.audit(100)).items
  } catch (e) {
    showToast((e as Error).message, false)
  }
}

async function loadFundPool() {
  try {
    fundPool.value = (await adminApi.fundPool()).items
  } catch (e) {
    showToast((e as Error).message, false)
  }
}

function initPriority() {
  if (summary.value && priorityDraft.value.length === 0) {
    priorityDraft.value = [...summary.value.market.sourcePriority]
    savedPriority.value = [...summary.value.market.sourcePriority]
  } else if (priorityDraft.value.length === 0) {
    loadDashboard().then(initPriority)
  }
}

function movePriority(i: number, dir: -1 | 1) {
  const j = i + dir
  const arr = [...priorityDraft.value]
  const [x] = arr.splice(i, 1)
  arr.splice(j, 0, x)
  priorityDraft.value = arr
}

async function savePriority() {
  savingPriority.value = true
  try {
    const r = await adminApi.setSourcePriority(priorityDraft.value)
    savedPriority.value = [...r.priority]
    if (summary.value) summary.value.market.sourcePriority = [...r.priority]
    showToast('优先级已保存')
  } catch (e) {
    showToast((e as Error).message, false)
  } finally {
    savingPriority.value = false
  }
}

async function syncMarket() {
  syncing.value = true
  try {
    const r = await adminApi.syncMarket()
    showToast(r.ok ? `同步成功: ${r.rows} 行 (来源 ${r.source ?? '?'})` : '同步失败: 所有源均失败', r.ok)
    await loadDashboard()
  } catch (e) {
    showToast((e as Error).message, false)
  } finally {
    syncing.value = false
  }
}

async function toggleUser(u: PanelUser) {
  try {
    await adminApi.setUserEnabled(u.id, !u.disabled)
    u.disabled = !u.disabled
    showToast(u.disabled ? '已禁用' : '已启用')
  } catch (e) {
    showToast((e as Error).message, false)
  }
}

async function removeUser(u: PanelUser) {
  if (!confirm(`确定删除用户 ${u.email}? 其全部数据将被软删除且账号被匿名化, 不可恢复。`)) return
  try {
    await adminApi.deleteUser(u.id)
    await loadUsers()
    showToast('已删除')
  } catch (e) {
    showToast((e as Error).message, false)
  }
}

async function removeFund(f: FundPoolItem) {
  if (!confirm(`确定从基金池移除 ${f.name} (${f.code})? 用户侧将不能再选择该基金。`)) return
  try {
    await adminApi.removeFund(f.code)
    await loadFundPool()
    showToast('已移除')
  } catch (e) {
    showToast((e as Error).message, false)
  }
}

function onUnauthorized() {
  if (authed.value) {
    authed.value = false
    showToast('会话已过期, 请重新登录', false)
  }
}

onMounted(() => {
  window.addEventListener('admin:unauthorized', onUnauthorized)
})
onUnmounted(() => {
  window.removeEventListener('admin:unauthorized', onUnauthorized)
})
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: linear-gradient(160deg, #0f172a 0%, #1e293b 100%);
}
.login-card {
  width: 380px;
  background: var(--panel);
  border-radius: 16px;
  padding: 36px 32px;
  box-shadow: 0 24px 48px rgba(0,0,0,.3);
}
.login-logo {
  width: 52px; height: 52px; border-radius: 14px;
  background: var(--brand-soft);
  display: grid; place-items: center;
  margin-bottom: 14px;
}
.login-title { font-size: 20px; font-weight: 700; margin: 0; }
.login-sub { font-size: 13px; color: var(--ink3); margin: 4px 0 22px; }
.login-err { margin-top: 12px; font-size: 13px; color: var(--neg); }

.layout { display: flex; min-height: 100vh; }
.sidebar {
  width: 216px;
  background: var(--sidebar);
  color: var(--sidebar-ink);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0; bottom: 0; left: 0;
  z-index: 10;
}
.side-brand {
  display: flex; align-items: center; gap: 8px;
  padding: 18px 20px;
  font-weight: 700; font-size: 15px; color: #f1f5f9;
  border-bottom: 1px solid #1e293b;
}
.side-nav { flex: 1; padding: 12px 10px; display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  background: transparent; color: var(--sidebar-ink);
  border: none; border-radius: 8px;
  padding: 9px 12px;
  font-size: 13.5px;
  text-align: left;
}
.nav-item:hover { background: var(--sidebar-active); color: #e2e8f0; }
.nav-item.active { background: var(--brand); color: #fff; }
.side-foot {
  padding: 14px 16px;
  border-top: 1px solid #1e293b;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.side-user { font-size: 12px; color: var(--sidebar-ink); overflow: hidden; text-overflow: ellipsis; }

.content {
  flex: 1;
  margin-left: 216px;
  padding: 28px 32px 60px;
  max-width: 1200px;
}

.source-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.source-row:last-of-type { border-bottom: none; }
.source-idx {
  width: 24px; height: 24px; border-radius: 6px;
  background: var(--brand-soft); color: var(--brand);
  display: grid; place-items: center;
  font-size: 12px; font-weight: 700;
}
.source-name { font-weight: 500; }

@media (max-width: 768px) {
  .sidebar { width: 100%; position: static; flex-direction: row; align-items: center; }
  .side-brand { border-bottom: none; padding: 12px 14px; }
  .side-nav { flex-direction: row; overflow-x: auto; padding: 8px; }
  .nav-item { white-space: nowrap; width: auto; }
  .side-foot { border-top: none; padding: 8px 12px; }
  .side-user { display: none; }
  .layout { flex-direction: column; }
  .content { margin-left: 0; padding: 18px 14px 60px; }
}
</style>
