<template>
  <AppShell>
    <div class="space-y-4">
      <header class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-bold tracking-tight">通道 · 顶底双线</h1>
          <p class="text-xs text-ink3 mt-0.5">历年底部连线 · 剔除避雷针的顶部连线</p>
        </div>
        <button @click="onRefresh" :disabled="channel.loading" class="btn-ghost">
          <svg class="h-4 w-4" :class="channel.loading ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
          {{ channel.loading ? '拉取中' : '刷新' }}
        </button>
      </header>

      <!-- 指数选择 chips -->
      <div class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button v-for="idx in PRESET_INDICES" :key="idx.secid" @click="onSelect(idx.secid)"
          :class="['shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                   channel.selection === idx.secid ? 'bg-brand text-white' : 'bg-surface2 text-ink2 hover:text-ink']">
          {{ idx.name }}
        </button>
      </div>

      <!-- 数据未就绪 -->
      <div v-if="!data" class="card card-pad text-center py-12">
        <p class="text-sm text-ink3">{{ channel.loading ? '正在拉取月 K 历史…' : '暂无数据' }}</p>
      </div>

      <template v-else>
        <!-- 状态卡 -->
        <ChannelStatus
          :zone="zoneInfo"
          :zoneClose="lastClose"
          :lowConfidence="!!data.channel?.lowConfidence"
          :error="data.error"
          :staleDate="staleDate"
          @retry="onRetry"
        />

        <!-- 通道图 -->
        <div v-if="data.channel" class="card card-pad">
          <ChannelChart :bars="data.bars" :channel="data.channel" />
          <p class="mt-2 text-[10px] text-ink3 text-right">数据截至 {{ staleDate }}</p>
        </div>

        <!-- 口径与可校验信息 (折叠) -->
        <details v-if="data.channel" class="card card-pad text-xs text-ink2">
          <summary class="cursor-pointer font-medium text-ink">
            拟合明细（被剔除避雷针 {{ data.channel.excludedSpikes.length }} 根 · 参与枢轴 高{{ data.channel.pivotHighs.length }}/低{{ data.channel.pivotLows.length }}）
          </summary>
          <div class="mt-2 space-y-2">
            <div v-if="data.channel.excludedSpikes.length > 0">
              <div class="text-[11px] text-ink3 mb-1">被剔除的避雷针（不参与顶线拟合）</div>
              <div v-for="s in data.channel.excludedSpikes" :key="s.t" class="flex justify-between text-rose-600 dark:text-rose-400">
                <span>{{ s.date.slice(0, 7) }}</span><span class="money">{{ s.value.toFixed(2) }}</span>
              </div>
            </div>
            <div>
              <div class="text-[11px] text-ink3 mb-1">顶线枢轴（高点）</div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <div v-for="p in data.channel.pivotHighs" :key="p.t" class="flex justify-between">
                  <span>{{ p.date.slice(0, 7) }}</span><span class="money">{{ p.value.toFixed(0) }}</span>
                </div>
              </div>
            </div>
            <div>
              <div class="text-[11px] text-ink3 mb-1">低线枢轴（低点）</div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <div v-for="p in data.channel.pivotLows" :key="p.t" class="flex justify-between">
                  <span>{{ p.date.slice(0, 7) }}</span><span class="money">{{ p.value.toFixed(0) }}</span>
                </div>
              </div>
            </div>
            <p class="text-[10px] text-ink3">口径：±{{ PIVOT_WINDOW_K }} 月分形枢轴 → Theil-Sen 斜率 → 包络截距；顶线剔除残差离群尖峰（≤{{ MAX_EXCLUDED_SPIKES }} 根）。两线中间以下慢慢买，以上慢慢卖。</p>
          </div>
        </details>
      </template>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import AppShell from '@/components/AppShell.vue'
import ChannelChart from '@/components/ChannelChart.vue'
import ChannelStatus from '@/components/ChannelStatus.vue'
import { useChannelStore } from '@/stores/channel'
import { zoneOf, PRESET_INDICES, PIVOT_WINDOW_K, MAX_EXCLUDED_SPIKES, type ZoneInfo } from '@/lib/indexChannel'

const channel = useChannelStore()

const data = computed(() => channel.current())

const lastClose = computed(() => {
  const bars = data.value?.bars
  return bars && bars.length > 0 ? bars[bars.length - 1].close : null
})

const zoneInfo = computed<ZoneInfo | null>(() => {
  const d = data.value
  if (!d?.channel || d.bars.length === 0 || lastClose.value == null) return null
  return zoneOf(lastClose.value, d.channel, d.bars.length - 1)
})

const staleDate = computed(() => {
  const bars = data.value?.bars
  return bars && bars.length > 0 ? bars[bars.length - 1].date.slice(0, 7) : undefined
})

function onSelect(secid: string) {
  if (secid !== channel.selection) void channel.selectIndex(secid)
}

function onRefresh() {
  void channel.refresh(channel.selection, { force: true })
}

function onRetry() {
  void channel.retry(channel.selection)
}

onMounted(async () => {
  await channel.loadSelection()
  await channel.selectIndex(channel.selection)
})
</script>
