<template>
  <AppShell>
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold tracking-tight">自选</h2>
          <p class="text-xs text-ink3">{{ list.length }} 只基金 · {{ quotesAt ? `行情 ${timeStr(quotesAt)}` : '行情未拉取' }}</p>
        </div>
        <button @click="refreshQuotes" :disabled="loadingQuotes || list.length === 0" class="btn-ghost">
          <svg class="h-4 w-4" :class="loadingQuotes ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
          {{ loadingQuotes ? '拉取中' : '刷新行情' }}
        </button>
      </div>

      <!-- 搜索添加 -->
      <div class="relative">
        <div class="flex gap-2">
          <input
            v-model="keyword"
            @input="onInput"
            @keydown.enter.prevent="pickFirst"
            @focus="searching = true"
            placeholder="搜索基金名称或代码添加 (至少 2 字符)"
            class="input flex-1"
          />
        </div>
        <!-- 搜索结果下拉 -->
        <div v-if="searching && results.length > 0" class="absolute z-20 mt-1 w-full rounded-xl border border-line bg-surface shadow-lg overflow-hidden">
          <button v-for="it in results" :key="it.code" @click="addWatch(it)"
            class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface2 transition">
            <span>
              <span class="font-medium">{{ it.name }}</span>
              <span class="ml-2 text-xs text-ink3">{{ it.code }}</span>
            </span>
            <span class="text-xs text-ink3">{{ it.type }}</span>
          </button>
        </div>
        <p v-if="searchErr" class="mt-1 text-xs text-neg">{{ searchErr }}</p>
        <p v-if="msg" class="mt-1 text-xs" :class="msgType === 'ok' ? 'text-pos' : 'text-neg'">{{ msg }}</p>
      </div>

      <!-- 自选列表 -->
      <div v-if="rows.length === 0 && list.length > 0" class="card card-pad text-center py-10 text-sm text-ink3">
        {{ loadingQuotes ? '行情拉取中…' : '行情拉取失败,点击「刷新行情」重试' }}
      </div>
      <div v-if="list.length === 0" class="card card-pad text-center py-12">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-ink3">
          <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </div>
        <p class="mt-2 text-sm text-ink3">暂无自选,搜索上方关键词添加</p>
      </div>
      <div v-for="r in rows" :key="r.code" class="card card-pad flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{{ r.name }}</span>
            <span class="shrink-0 text-xs text-ink3">{{ r.code }}</span>
          </div>
          <div class="mt-0.5 text-xs text-ink3">
            {{ r.nav != null ? `${r.navDate} ${r.isEstimate ? '估值' : '净值'}` : '行情拉取失败' }}
          </div>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <div class="text-right">
            <div class="money text-sm font-bold">{{ r.nav != null ? r.nav.toFixed(4) : '--' }}</div>
            <div class="text-xs" :class="chgClass(r)">
              {{ chgText(r) }}
            </div>
          </div>
          <button @click="removeWatch(r.code)" class="btn-ghost !px-2 text-ink3 hover:text-neg" title="删除自选">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AppShell from '@/components/AppShell.vue'
import { api } from '@/lib/api'
import { metaRepo } from '@/repos/metaRepo'

/** 自选条目 (持久化到 meta['watchlist']) */
interface WatchItem { code: string; name: string; type: string; addedAt: number }
/** 行情行 (服务端 /api/market/fund-quotes) */
interface QuoteRow { code: string; name: string; nav: number; isEstimate: boolean; navDate: string; source: string }
/** 列表行 = 自选 + 行情 */
interface WatchRow extends WatchItem { nav: number | null; isEstimate: boolean; navDate: string }

const WATCH_KEY = 'watchlist'

const list = ref<WatchItem[]>([])
const quotes = ref<Map<string, QuoteRow>>(new Map())
const quotesAt = ref<number | null>(null)
const loadingQuotes = ref(false)

const keyword = ref('')
const results = ref<{ code: string; name: string; type: string }[]>([])
const searching = ref(false)
const searchErr = ref('')
const msg = ref('')
const msgType = ref<'ok' | 'err'>('ok')
let searchSeq = 0
let blurTimer: ReturnType<typeof setTimeout> | null = null

const rows = computed<WatchRow[]>(() =>
  list.value.map(w => {
    const q = quotes.value.get(w.code)
    return {
      ...w,
      nav: q?.nav ?? null,
      isEstimate: q?.isEstimate ?? false,
      navDate: q?.navDate ?? ''
    }
  })
)

function timeStr(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 昨日净值: fund-history 最新前两根, 差值即日涨跌 (口径与天天基金一致) */
const chgCache = new Map<string, { prev: number | null }>()
async function loadPrevNavs(codes: string[]): Promise<void> {
  const need = codes.filter(c => c && !chgCache.has(c))
  const results = await Promise.all(need.map(async code => {
    try {
      const r = await api.get<{ bars: Array<{ date: string; nav: number }> }>(`/api/market/fund-history?code=${code}&days=100`)
      const bars = r.bars || []
      return { code, prev: bars.length >= 2 ? bars[bars.length - 2].nav : null }
    } catch {
      return { code, prev: null }
    }
  }))
  for (const { code, prev } of results) chgCache.set(code, { prev })
}

function chgPct(r: WatchRow): number | null {
  const prev = chgCache.get(r.code)?.prev
  if (r.nav == null || prev == null || prev <= 0) return null
  return ((r.nav - prev) / prev) * 100
}
function chgClass(r: WatchRow): string {
  const p = chgPct(r)
  if (p == null) return 'text-ink3'
  return p >= 0 ? 'text-pos' : 'text-neg'
}
function chgText(r: WatchRow): string {
  const p = chgPct(r)
  if (p == null) return '--'
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
}

async function loadAll(): Promise<void> {
  const snap = await metaRepo.get(WATCH_KEY)
  const v = snap?.value as { items?: WatchItem[] } | undefined
  list.value = Array.isArray(v?.items) ? v.items : []
  quotesAt.value = (snap?.value as { quotesAt?: number } | undefined)?.quotesAt ?? null
  if (list.value.length > 0) {
    await refreshQuotes()
  }
}

async function persist(): Promise<void> {
  await metaRepo.put({ key: WATCH_KEY, value: { items: list.value, quotesAt: quotesAt.value } })
}

async function refreshQuotes(): Promise<void> {
  if (list.value.length === 0 || loadingQuotes.value) return
  loadingQuotes.value = true
  msg.value = ''
  try {
    const codes = list.value.map(w => w.code)
    const r = await api.get<{ items: QuoteRow[] }>(`/api/market/fund-quotes?codes=${codes.join(',')}`)
    const m = new Map<string, QuoteRow>()
    for (const it of r.items || []) m.set(it.code, it)
    quotes.value = m
    quotesAt.value = Date.now()
    await loadPrevNavs(codes)
    await persist()
  } catch (e) {
    msg.value = `行情拉取失败: ${(e as Error).message}`
    msgType.value = 'err'
  } finally {
    loadingQuotes.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null
function onInput(): void {
  if (debounce) clearTimeout(debounce)
  const kw = keyword.value.trim()
  if (kw.length < 2) { results.value = []; searchErr.value = ''; return }
  debounce = setTimeout(() => doSearch(kw), 350)
}

async function doSearch(kw: string): Promise<void> {
  const seq = ++searchSeq
  searchErr.value = ''
  try {
    const r = await api.get<{ items: { code: string; name: string; type: string }[] }>(`/api/market/fund-search?key=${encodeURIComponent(kw)}`)
    if (seq !== searchSeq) return // 过期响应丢弃
    results.value = r.items || []
    searching.value = true
  } catch (e) {
    if (seq !== searchSeq) return
    results.value = []
    searchErr.value = `搜索失败: ${(e as Error).message}`
  }
}

function pickFirst(): void {
  if (results.value.length > 0) addWatch(results.value[0])
}

async function addWatch(it: { code: string; name: string; type: string }): Promise<void> {
  if (list.value.some(w => w.code === it.code)) {
    msg.value = `${it.name} 已在自选中`
    msgType.value = 'err'
    return
  }
  list.value = [...list.value, { ...it, addedAt: Date.now() }]
  msg.value = `已添加 ${it.name}`
  msgType.value = 'ok'
  searching.value = false
  keyword.value = ''
  results.value = []
  await persist()
  await refreshQuotes()
}

async function removeWatch(code: string): Promise<void> {
  list.value = list.value.filter(w => w.code !== code)
  chgCache.delete(code)
  await persist()
}

onMounted(async () => {
  await loadAll()
})

onBeforeUnmount(() => {
  if (blurTimer) clearTimeout(blurTimer)
  if (debounce) clearTimeout(debounce)
})
</script>
