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

      <!-- 指数 chips (用户列表, 选中项带 × 删除) -->
      <div class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <div v-for="idx in chipIndices" :key="idx.secid"
             :class="['shrink-0 flex items-center rounded-full text-xs font-medium transition-colors',
                      channel.selection === idx.secid ? 'bg-brand text-white' : 'bg-surface2 text-ink2']">
          <button @click="onSelect(idx.secid)" class="py-1.5 rounded-l-full" :class="idx.secid === channel.selection && channel.myIndices.length > 1 ? 'pl-3' : 'px-3'">
            {{ idx.name }}
          </button>
          <button v-if="idx.secid === channel.selection && channel.myIndices.length > 1"
                  @click="onRemove(idx.secid)" title="从列表移除"
                  class="pr-2.5 pl-0.5 py-1.5 opacity-70 hover:opacity-100" aria-label="删除指数">
            <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <button @click="manageOpen = true" class="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium bg-surface2 text-ink2 hover:text-ink"
                title="添加指数" aria-label="管理指数列表">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
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
          <div class="mt-2 grid gap-x-6 gap-y-2 md:grid-cols-3">
            <div v-if="data.channel.excludedSpikes.length > 0">
              <div class="text-[11px] text-ink3 mb-1">被剔除的避雷针（不参与顶线拟合）</div>
              <div v-for="s in data.channel.excludedSpikes" :key="s.t" class="flex justify-between text-neg">
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

        <!-- 15 年策略回测 -->
        <BacktestCard strategy="b" :current-secid="channel.selection" :current-name="nameOf(channel.selection)" />
      </template>

      <!-- 管理弹层: 添加/移除指数 -->
      <div v-if="manageOpen" class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" @click.self="manageOpen = false">
        <div class="w-full max-w-md rounded-t-2xl bg-surface p-4 pb-6 shadow-xl md:rounded-2xl md:pb-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-bold">管理指数</h3>
            <button @click="manageOpen = false" class="btn-ghost !px-2 !py-1" aria-label="关闭">✕</button>
          </div>
          <p class="mb-2 text-[11px] text-ink3">我的列表（至少保留 1 个，点 − 移除）</p>
          <div class="mb-4 space-y-1.5">
            <div v-for="secid in channel.myIndices" :key="secid" class="flex items-center justify-between rounded-lg bg-surface2 px-3 py-2">
              <span class="text-sm text-ink">{{ nameOf(secid) }}</span>
              <button @click="onRemove(secid)" :disabled="channel.myIndices.length <= 1"
                      :class="['rounded-md px-2 py-0.5 text-xs font-medium', channel.myIndices.length <= 1 ? 'text-ink3/50' : 'text-neg hover:bg-red-50']"
                      aria-label="移除">−</button>
            </div>
          </div>
          <p class="mb-2 text-[11px] text-ink3">可添加</p>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="idx in addableIndices" :key="idx.secid" @click="onAdd(idx.secid)"
                    class="rounded-full bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/20">
              + {{ idx.name }}
            </button>
            <span v-if="addableIndices.length === 0" class="text-xs text-ink3">已全部添加</span>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import BacktestCard from '@/components/BacktestCard.vue'
import ChannelChart from '@/components/ChannelChart.vue'
import ChannelStatus from '@/components/ChannelStatus.vue'
import { useChannelStore } from '@/stores/channel'
import { zoneOf, PRESET_INDICES, PIVOT_WINDOW_K, MAX_EXCLUDED_SPIKES, type ZoneInfo } from '@/lib/indexChannel'

const channel = useChannelStore()
const manageOpen = ref(false)

const data = computed(() => channel.current())

/** chips 显示用户的列表 (名称从预设映射, 兜底显示 secid) */
const chipIndices = computed(() =>
  channel.myIndices.map(secid => ({ secid, name: nameOf(secid) }))
)

const addableIndices = computed(() =>
  PRESET_INDICES.filter(i => !channel.myIndices.includes(i.secid))
)

function nameOf(secid: string): string {
  return PRESET_INDICES.find(i => i.secid === secid)?.name ?? secid
}

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

function onAdd(secid: string) {
  void channel.addIndex(secid)
}

function onRemove(secid: string) {
  if (channel.myIndices.length <= 1) return
  void channel.removeIndex(secid)
}

onMounted(async () => {
  try {
    await channel.loadIndices()
  } catch { /* 列表读取失败 → 用默认列表继续 */ }
  try {
    await channel.loadSelection()
  } catch { /* 选择记忆失败 → 默认上证 */ }
  await channel.selectIndex(channel.selection)
})
</script>
