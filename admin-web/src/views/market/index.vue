<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchPanelSummary, fetchSetSourcePriority, fetchSyncMarket } from '@/service/api';

defineOptions({ name: 'MarketView' });

const priority = ref<string[]>([]);
const latest = ref<{ latestDate: string | null; latestSource: string | null }>({
  latestDate: null,
  latestSource: null
});
const sourceHealth = ref<Record<string, { lastOkAt: number | null; failStreak: number }>>({});

const SOURCE_NAMES: Record<string, string> = {
  tencent: '腾讯',
  eastmoney: '东财',
  yahoo: 'Yahoo',
  xueqiu: '雪球'
};

function sourceName(s: string) {
  return SOURCE_NAMES[s] || s;
}
const loading = ref(false);
const syncing = ref(false);

async function load() {
  loading.value = true;
  const { data, error } = await fetchPanelSummary();
  loading.value = false;
  if (!error && data) {
    priority.value = [...data.market.sourcePriority];
    latest.value = { latestDate: data.market.latestDate, latestSource: data.market.latestSource };
    sourceHealth.value = data.sourceHealth || {};
  }
}

function healthDot(s: string): 'green' | 'red' | 'gray' {
  const h = sourceHealth.value[s];
  if (!h) return 'gray';
  return h.failStreak > 0 ? 'red' : 'green';
}

function healthText(s: string): string {
  const h = sourceHealth.value[s];
  if (!h) return '暂无健康数据';
  const mins = h.lastOkAt ? Math.max(0, Math.round((Date.now() - h.lastOkAt) / 60000)) : null;
  const okPart = mins === null ? '最近成功: 未知' : `最近成功 ${mins} 分钟前`;
  return `${okPart} · 连续失败 ${h.failStreak} 次`;
}

function move(i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= priority.value.length) return;
  const arr = [...priority.value];
  [arr[i], arr[j]] = [arr[j], arr[i]];
  priority.value = arr;
}

async function savePriority() {
  const { error } = await fetchSetSourcePriority(priority.value);
  if (!error) {
    ElMessage.success('优先级已保存并持久化');
    await load();
  }
}

async function syncMarket() {
  syncing.value = true;
  const { data, error } = await fetchSyncMarket();
  syncing.value = false;
  if (!error && data) {
    ElMessage.success(`同步完成, ${data.rows} 行 (来源: ${data.source || '—'})`);
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="grid gap-12px md:grid-cols-2">
    <ElCard shadow="never">
      <template #header>
        <span>行情数据源优先级</span>
      </template>
      <div class="mb-12px text-13px text-gray-500">
        数字越小优先级越高。自动同步时按此顺序尝试获取行情。
      </div>
      <div v-for="(s, i) in priority" :key="s" class="mb-8px flex-y-center gap-8px">
        <ElTag type="info" effect="plain" size="large">{{ i + 1 }}</ElTag>
        <span class="font-500">{{ sourceName(s) }}</span>
        <ElTooltip :content="healthText(s)" placement="top">
          <span
            class="inline-block w-8px h-8px rounded-full"
            :class="healthDot(s) === 'green' ? 'bg-green-500' : healthDot(s) === 'red' ? 'bg-red-500' : 'bg-gray-300'"
          />
        </ElTooltip>
        <div class="ml-auto">
          <ElButton size="small" circle :disabled="i === 0" @click="move(i, -1)">↑</ElButton>
          <ElButton size="small" circle :disabled="i === priority.length - 1" @click="move(i, 1)">↓</ElButton>
        </div>
      </div>
      <ElButton type="primary" class="mt-8px" :loading="loading" @click="savePriority">保存优先级</ElButton>
    </ElCard>

    <ElCard shadow="never">
      <template #header>
        <span>行情同步</span>
      </template>
      <div class="text-14px">
        最新数据日期:
        <b>{{ latest.latestDate || '—' }}</b>
      </div>
      <div class="mt-8px text-14px">
        最新来源:
        <ElTag v-if="latest.latestSource" size="small">{{ latest.latestSource }}</ElTag>
        <span v-else>—</span>
      </div>
      <ElButton type="primary" class="mt-16px" :loading="syncing" @click="syncMarket">
        {{ syncing ? '同步中…' : '立即同步行情' }}
      </ElButton>
    </ElCard>
  </div>
</template>
