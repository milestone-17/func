<template>
  <div class="card card-pad">
    <div v-if="rows.length === 0" class="py-10 text-center text-sm text-ink3">
      无匹配标的
    </div>
    <div v-else class="overflow-x-auto -mx-4">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-xs text-ink3 border-b border-line">
            <th class="text-left font-medium px-4 py-2">名称</th>
            <th class="text-left font-medium px-2 py-2">代码</th>
            <th class="text-left font-medium px-2 py-2">类型</th>
            <th class="text-right font-medium px-2 py-2">PE-TTM</th>
            <th class="text-right font-medium px-2 py-2">PB</th>
            <th class="text-left font-medium px-2 py-2 min-w-[160px]">分位</th>
            <th class="text-left font-medium px-2 py-2">档位</th>
            <th class="text-left font-medium px-2 py-2 hidden sm:table-cell">建议</th>
            <th class="text-right font-medium px-4 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.code" :class="rowClass(r)">
            <td class="px-4 py-2.5 font-medium text-ink">{{ r.name }}</td>
            <td class="px-2 py-2.5 text-xs text-ink2 font-mono">{{ r.code }}</td>
            <td class="px-2 py-2.5">
              <span class="text-[10px] text-ink3 px-1.5 py-0.5 rounded bg-surface2">
                {{ r.kind === 'index' ? '指数' : '行业' }}
              </span>
            </td>
            <td class="px-2 py-2.5 text-right text-ink2 tabular-nums">
              {{ r.peTtm != null ? r.peTtm.toFixed(2) : '—' }}
            </td>
            <td class="px-2 py-2.5 text-right text-ink2 tabular-nums">
              {{ r.pb != null ? r.pb.toFixed(2) : '—' }}
            </td>
            <td class="px-2 py-2.5">
              <div v-if="r.percentile != null" class="flex items-center gap-2">
                <div class="h-1.5 flex-1 rounded-full bg-surface2 overflow-hidden">
                  <div class="h-full rounded-full"
                       :class="barClass(r)"
                       :style="{ width: r.percentile + '%' }" />
                </div>
                <span class="text-xs font-semibold tabular-nums w-7 text-right">{{ r.percentile }}</span>
              </div>
              <span v-else class="text-xs text-ink3">—</span>
            </td>
            <td class="px-2 py-2.5">
              <Badge v-if="r.bucketLabel" :tone="badgeTone(r.bucketTone)">{{ r.bucketLabel }}</Badge>
              <span v-else class="text-xs text-ink3">—</span>
            </td>
            <td class="px-2 py-2.5 text-xs text-ink2 hidden sm:table-cell">
              {{ r.bucketAdvice || '—' }}
            </td>
            <td class="px-4 py-2.5 text-right">
              <button
                v-if="r.failReason"
                @click="$emit('retry', r.code)"
                class="text-xs text-brand hover:underline"
              >
                重试
              </button>
              <span v-else class="text-xs text-ink3">·</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import Badge from './Badge.vue'
import type { ValuationRow } from '@/types/valuation'

defineProps<{ rows: ValuationRow[] }>()
defineEmits<{ retry: [code: string] }>()

function rowClass(r: ValuationRow): string {
  if (r.bucketTone === 'green') return 'border-b border-line/40 hover:bg-emerald-50/40 dark:hover:bg-emerald-500/5'
  if (r.bucketTone === 'red') return 'border-b border-line/40 hover:bg-rose-50/40 dark:hover:bg-rose-500/5'
  return 'border-b border-line/40 hover:bg-surface2/40'
}

function barClass(r: ValuationRow): string {
  if (r.bucketTone === 'green') return 'bg-emerald-500'
  if (r.bucketTone === 'red') return 'bg-rose-500'
  return 'bg-sky-500'
}

function badgeTone(tone: ValuationRow['bucketTone']): 'green' | 'red' | 'blue' | 'gray' {
  if (tone === 'green') return 'green'
  if (tone === 'red') return 'red'
  if (tone === 'blue') return 'blue'
  return 'gray'
}
</script>
