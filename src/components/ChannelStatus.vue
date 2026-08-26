<template>
  <div class="card card-pad space-y-3">
    <!-- 失败态 -->
    <template v-if="error && !zone">
      <div class="flex items-center justify-between">
        <span class="text-sm text-neg">通道拉取失败</span>
        <button @click="$emit('retry')" class="text-xs font-medium text-brand hover:underline">重试</button>
      </div>
      <p v-if="staleDate" class="text-[11px] text-ink3">仍显示数据截至 {{ staleDate }} 的缓存</p>
    </template>

    <template v-else-if="zone">
      <!-- 区域结论 -->
      <div class="flex items-center justify-between">
        <div>
          <div class="text-[11px] text-ink3">当前区域结论</div>
          <div class="mt-0.5 text-lg font-bold" :class="zoneClass">{{ zoneLabel }}</div>
        </div>
        <div class="text-right">
          <div class="text-[11px] text-ink3">当前点位</div>
          <div class="money text-lg font-bold">{{ zoneClose != null ? zoneClose.toFixed(2) : '—' }}</div>
        </div>
      </div>

      <!-- 通道位置百分位 -->
      <div>
        <div class="flex justify-between text-[10px] text-ink3">
          <span>低线 0%</span>
          <span>通道位置 {{ zone.posPct.toFixed(0) }}%</span>
          <span>顶线 100%</span>
        </div>
        <div class="mt-1 h-2 rounded-full bg-surface2 overflow-hidden relative">
          <div class="absolute inset-y-0 left-1/2 w-px bg-ink3/40" />
          <div class="h-full rounded-full transition-[width] duration-300"
               :class="barColor" :style="{ width: zone.posPct + '%' }" />
        </div>
      </div>

      <!-- 三线今日数值 -->
      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="rounded-lg bg-rose-50 dark:bg-rose-500/10 py-1.5">
          <div class="text-[10px] text-ink3">顶线今日</div>
          <div class="money text-sm font-semibold text-rose-600 dark:text-rose-400">{{ zone.top.toFixed(0) }}</div>
        </div>
        <div class="rounded-lg bg-surface2 py-1.5">
          <div class="text-[10px] text-ink3">中线今日</div>
          <div class="money text-sm font-semibold">{{ zone.mid.toFixed(0) }}</div>
        </div>
        <div class="rounded-lg bg-amber-50 dark:bg-amber-500/10 py-1.5">
          <div class="text-[10px] text-ink3">低线今日</div>
          <div class="money text-sm font-semibold text-amber-600 dark:text-amber-400">{{ zone.bottom.toFixed(0) }}</div>
        </div>
      </div>

      <!-- 置信度提示 -->
      <p v-if="lowConfidence" class="text-[11px] text-warn">⚠ 历史不足，通道仅供参考</p>
      <p v-if="error && zone" class="text-[11px] text-warn">刷新失败，仍显示数据截至 {{ staleDate }} 的缓存</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ZONE_LABELS, type ZoneInfo } from '@/lib/indexChannel'

const props = defineProps<{
  zone: ZoneInfo | null
  zoneClose: number | null
  lowConfidence: boolean
  error?: string
  staleDate?: string
}>()
defineEmits<{ retry: [] }>()

const ZONE_STYLES: Record<string, { label: string; text: string; bar: string }> = {
  'strong-buy': { label: '重仓买入', text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  'buy': { label: '慢慢买', text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-400' },
  'sell': { label: '慢慢卖', text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-400' },
  'strong-sell': { label: '坚决卖', text: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' }
}

const zoneLabel = computed(() => props.zone ? (ZONE_LABELS[props.zone.zone] ?? ZONE_STYLES[props.zone.zone]?.label) : '')
const zoneClass = computed(() => props.zone ? ZONE_STYLES[props.zone.zone]?.text ?? '' : '')
const barColor = computed(() => props.zone ? ZONE_STYLES[props.zone.zone]?.bar ?? 'bg-brand' : 'bg-brand')
</script>
