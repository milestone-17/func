<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { fetchFundPool, fetchRemoveFund, fetchSearchFunds, fmtTime } from '@/service/api';
import type { FundPoolItem, FundSearchItem } from '@/service/api';

defineOptions({ name: 'FundPoolView' });

const items = ref<FundPoolItem[]>([]);
const loading = ref(false);
const searchKey = ref('');
const searchLoading = ref(false);
const searchResults = ref<FundSearchItem[]>([]);

async function load() {
  loading.value = true;
  const { data, error } = await fetchFundPool();
  loading.value = false;
  if (!error && data) items.value = data.items;
}

async function removeFund(row: FundPoolItem) {
  await ElMessageBox.confirm(`确定从基金池移除 ${row.name} (${row.code}) ?`, '移除确认', {
    confirmButtonText: '移除',
    cancelButtonText: '取消',
    type: 'warning'
  });
  const { error } = await fetchRemoveFund(row.code);
  if (!error) {
    ElMessage.success('已移除');
    await load();
  }
}

async function doSearch() {
  const k = searchKey.value.trim();
  if (!k) return;
  searchLoading.value = true;
  const { data, error } = await fetchSearchFunds(k);
  searchLoading.value = false;
  if (!error && data) {
    searchResults.value = data.items;
    if (data.items.length === 0) ElMessage.info('未找到匹配基金');
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="mb-12px flex-y-center justify-between">
      <span class="text-16px font-500">共 {{ items.length }} 只基金</span>
      <div class="flex gap-8px">
        <ElInput
          v-model="searchKey"
          placeholder="按代码或名称搜索基金…"
          clearable
          style="width: 260px"
          @keyup.enter="doSearch"
        />
        <ElButton :loading="searchLoading" @click="doSearch">搜索</ElButton>
        <ElButton :loading="loading" @click="load">刷新</ElButton>
      </div>
    </div>

    <ElCard v-if="searchResults.length" class="mb-12px" shadow="never">
      <div class="mb-8px text-14px text-gray-500">搜索结果 ({{ searchResults.length }})</div>
      <div class="flex flex-wrap gap-8px">
        <ElTag
          v-for="r in searchResults"
          :key="r.code"
          closable
          type="primary"
          effect="plain"
          @close="undefined"
        >
          {{ r.code }} · {{ r.name }} ({{ r.type }})
        </ElTag>
      </div>
      <div class="mt-8px text-12px text-gray-400">提示: 基金由用户端定投流程加入池中, 后台仅提供查询与移除</div>
    </ElCard>

    <ElCard shadow="never" :body-style="{ padding: 0 }">
      <ElTable v-loading="loading" :data="items" stripe>
        <ElTableColumn prop="code" label="代码" width="120" />
        <ElTableColumn prop="name" label="名称" min-width="200" show-overflow-tooltip />
        <ElTableColumn prop="histRows" label="净值行数" width="120" align="right" />
        <ElTableColumn label="加入时间" width="140">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="100" align="right">
          <template #default="{ row }">
            <ElButton size="small" type="danger" plain @click="removeFund(row)">移除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </ElCard>
  </div>
</template>
