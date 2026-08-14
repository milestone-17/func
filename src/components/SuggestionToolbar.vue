<template>
  <div class="space-y-3">
    <!-- 搜索框 -->
    <div class="relative">
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
      </svg>
      <input
        :value="search"
        @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
        type="text"
        placeholder="搜索行业或指数名称 (例: 医药, 300)"
        class="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2.5 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand/60"
      />
    </div>

    <!-- 排序模式 + 拉取 -->
    <div class="flex items-center gap-2">
      <div class="flex rounded-xl border border-line bg-surface p-0.5 text-xs font-medium">
        <button
          @click="$emit('update:sortMode', 'priority')"
          :class="['px-3 py-1.5 rounded-lg transition',
                   sortMode === 'priority' ? 'bg-brand text-white' : 'text-ink2 hover:text-ink']"
        >
          优先级
          <span class="text-[10px] opacity-70 ml-0.5">估值低→高</span>
        </button>
        <button
          @click="$emit('update:sortMode', 'selection')"
          :class="['px-3 py-1.5 rounded-lg transition',
                   sortMode === 'selection' ? 'bg-brand text-white' : 'text-ink2 hover:text-ink']"
        >
          选型
          <span class="text-[10px] opacity-70 ml-0.5">估值高→低</span>
        </button>
      </div>
      <div class="flex-1" />
      <button
        @click="$emit('fetch')"
        :disabled="loading"
        class="btn-primary !text-sm !py-2 flex items-center gap-1.5"
      >
        <svg :class="['h-4 w-4', loading ? 'animate-spin' : '']" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>
        </svg>
        {{ loading ? '拉取中' : '拉取估值' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SortMode } from '@/types/valuation'

defineProps<{ search: string; sortMode: SortMode; loading: boolean }>()
defineEmits<{
  'update:search': [q: string]
  'update:sortMode': [m: SortMode]
  fetch: []
}>()
</script>
