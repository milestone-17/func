<template>
  <AppShell>
    <div class="space-y-4">
      <!-- 标题 + 陈旧提示 -->
      <header class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-bold tracking-tight">建议 · 市场温度计</h1>
          <p class="text-xs text-ink3 mt-0.5">PE-TTM 历史百分位 · 5 档分级</p>
        </div>
      </header>

      <!-- 进度条 (顶部细条) -->
      <div v-if="valuation.loading || valuation.progress > 0" class="h-1 rounded-full bg-surface2 overflow-hidden -mt-2">
        <div class="h-full bg-brand transition-[width] duration-300"
             :style="{ width: valuation.progress + '%' }" />
      </div>

      <!-- 工具栏: 搜索 + 排序 + 拉取 -->
      <SuggestionToolbar
        :search="valuation.search"
        :sortMode="valuation.sortMode"
        :loading="valuation.loading"
        @update:search="valuation.setSearch"
        @update:sortMode="valuation.setSortMode"
        @fetch="onFetch"
      />

      <!-- 摘要卡: 最低估 / 最高估 / 拉取时间 -->
      <SuggestionSummary
        :lowest="valuation.summary.lowest"
        :highest="valuation.summary.highest"
        :lastFetchedAt="valuation.lastFetchedAt"
        :staleDate="valuation.staleDate"
      />

      <!-- 表格 或 空状态 -->
      <SuggestionTable
        v-if="valuation.displayedRows.length > 0"
        :rows="valuation.displayedRows"
        @retry="onRetry"
      />

      <!-- 完全无数据时的空状态 -->
      <div v-else-if="!valuation.loading" class="card card-pad text-center py-12">
        <div class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand">
          <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18h6"/><path d="M10 22h4"/>
            <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2v.3a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V17a3 3 0 0 1 1-2A7 7 0 0 0 12 2Z"/>
          </svg>
        </div>
        <h3 class="mt-3 font-semibold">暂无数据</h3>
        <p class="mt-1 text-sm text-ink3 px-6">点击右上角"拉取估值"获取行业与指数分位</p>
      </div>

      <!-- 拉取失败 toast -->
      <div v-if="errorMsg" class="card card-pad bg-rose-50 border-rose-200 text-rose-700 text-sm">
        ⚠ {{ errorMsg }}
        <button @click="errorMsg = ''" class="ml-2 text-rose-500 hover:underline">×</button>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import AppShell from '@/components/AppShell.vue'
import SuggestionToolbar from '@/components/SuggestionToolbar.vue'
import SuggestionTable from '@/components/SuggestionTable.vue'
import SuggestionSummary from '@/components/SuggestionSummary.vue'
import { useValuationStore } from '@/stores/valuation'

const valuation = useValuationStore()
const errorMsg = ref('')

async function onFetch() {
  errorMsg.value = ''
  const { ok, fail } = await valuation.fetchAll()
  if (ok === 0 && fail > 0) {
    if (!valuation.staleDate) {
      errorMsg.value = '拉取失败, 本地也无历史快照'
    } else {
      errorMsg.value = `全部 ${fail} 个标的拉取失败, 已显示 ${valuation.staleDate} 的陈旧快照`
    }
  } else if (fail > 0) {
    errorMsg.value = `成功 ${ok} 个, 失败 ${fail} 个 (点击行末"重试"可单独重拉)`
  }
}

async function onRetry(code: string) {
  await valuation.retryOne(code)
}

onMounted(async () => {
  await valuation.loadFromCache()
})

onUnmounted(() => {
  // 离开页面时清空搜索词 (避免下次进入残留)
  valuation.setSearch('')
})
</script>
