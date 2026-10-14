<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchAudit, fmtTime } from '@/service/api';
import type { AuditItem } from '@/service/api';

defineOptions({ name: 'AuditView' });

const items = ref<AuditItem[]>([]);
const loading = ref(false);
const limit = ref(50);

async function load() {
  loading.value = true;
  const { data, error } = await fetchAudit(limit.value);
  loading.value = false;
  if (!error && data) items.value = data.items;
}

function fmtDetail(d: unknown): string {
  if (d === null || d === undefined) return '—';
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="mb-12px flex-y-center justify-between">
      <span class="text-16px font-500">最近 {{ items.length }} 条操作</span>
      <div class="flex items-center gap-8px">
        <ElInputNumber v-model="limit" :min="10" :max="500" :step="50" />
        <ElButton :loading="loading" @click="load">刷新</ElButton>
      </div>
    </div>

    <ElCard shadow="never" :body-style="{ padding: 0 }">
      <ElTable v-loading="loading" :data="items" stripe>
        <ElTableColumn prop="actor" label="操作者" width="220" show-overflow-tooltip />
        <ElTableColumn label="动作" width="160">
          <template #default="{ row }">
            <ElTag size="small">{{ row.action }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="target" label="对象" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.target || '—' }}</template>
        </ElTableColumn>
        <ElTableColumn label="详情" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">{{ fmtDetail(row.detail) }}</template>
        </ElTableColumn>
        <ElTableColumn label="时间" width="140">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </ElTableColumn>
      </ElTable>
    </ElCard>
  </div>
</template>
