<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchPanelSummary, fetchSyncMarket, fmtTime } from '@/service/api';
import type { PanelSummary } from '@/service/api';

defineOptions({ name: 'HomeView' });

const summary = ref<PanelSummary | null>(null);
const loading = ref(false);
const fetchedAt = ref<string | null>(null);
const syncing = ref(false);

async function load() {
  loading.value = true;
  const { data, error } = await fetchPanelSummary();
  loading.value = false;
  if (!error && data) {
    summary.value = data;
    fetchedAt.value = new Date().toISOString();
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

const isStale = () => {
  const d = summary.value?.market.latestDate;
  if (!d) return true;
  return Date.now() - new Date(d).getTime() > 24 * 3600 * 1000;
};

const userCards = () => {
  const u = summary.value?.users;
  if (!u) return [];
  return [
    { label: '注册用户', value: u.total, color: '' },
    { label: '今日活跃', value: u.activeToday, color: 'var(--el-color-success)' },
    { label: '访客用户', value: u.guests, color: '' },
    { label: '已禁用', value: u.disabled, color: 'var(--el-color-danger)' }
  ];
};

const dataCards = () => {
  const d = summary.value?.data;
  if (!d) return [];
  return [
    { label: '交易记录', value: d.transactions, color: '' },
    { label: '持仓', value: d.holdings, color: '' },
    { label: '指数K线行数', value: d.indexRows, color: '' },
    { label: '基金净值行数', value: d.fundHistRows, color: '' },
    { label: '定投基金', value: d.dcaFunds, color: '' }
  ];
};

onMounted(load);
</script>

<template>
  <div class="min-h-500px">
    <ElCard v-if="loading && !summary" shadow="never">
      <ElSkeleton :rows="5" animated />
    </ElCard>

    <template v-else-if="summary">
      <div class="grid grid-cols-2 gap-12px md:grid-cols-4">
        <ElCard v-for="c in userCards()" :key="c.label" shadow="hover">
          <div class="text-14px text-gray-500">{{ c.label }}</div>
          <div class="mt-8px text-28px font-600" :style="{ color: c.color || undefined }">{{ c.value }}</div>
        </ElCard>
      </div>

      <div class="mt-12px grid grid-cols-2 gap-12px md:grid-cols-5">
        <ElCard v-for="c in dataCards()" :key="c.label" shadow="hover">
          <div class="text-14px text-gray-500">{{ c.label }}</div>
          <div class="mt-8px text-22px font-600">{{ c.value }}</div>
        </ElCard>
      </div>

      <ElCard class="mt-12px" shadow="never">
        <div class="flex-y-center justify-between">
          <div>
            <div class="text-14px text-gray-500">行情状态</div>
            <div class="mt-8px">
              最新数据日期
              <b>{{ summary.market.latestDate || '—' }}</b>
              <ElTag v-if="summary.market.latestSource" class="ml-8px" size="small">
                来源: {{ summary.market.latestSource }}
              </ElTag>
              <ElTag v-if="isStale()" class="ml-8px" type="danger" size="small">已滞后 24h+</ElTag>
            </div>
            <div class="mt-8px text-12px text-gray-400">数据更新于 {{ fmtTime(fetchedAt) }}</div>
          </div>
          <ElButton type="primary" :loading="syncing" @click="syncMarket">
            {{ syncing ? '同步中…' : '立即同步行情' }}
          </ElButton>
        </div>
        <div class="mt-12px text-14px text-gray-500">当前源优先级</div>
        <div class="mt-8px flex flex-wrap gap-6px">
          <ElTag v-for="(s, i) in summary.market.sourcePriority" :key="s" type="info" effect="plain">
            {{ i + 1 }}. {{ s }}
          </ElTag>
        </div>
      </ElCard>
    </template>
  </div>
</template>
