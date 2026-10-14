<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { fetchDeleteUser, fetchPanelUsers, fetchSetUserEnabled, fmtTime } from '@/service/api';
import type { PanelUser } from '@/service/api';

defineOptions({ name: 'UsersView' });

const users = ref<PanelUser[]>([]);
const loading = ref(false);
const filter = ref('');

const filtered = computed(() => {
  const k = filter.value.trim().toLowerCase();
  if (!k) return users.value;
  return users.value.filter(u => u.email.toLowerCase().includes(k));
});

async function load() {
  loading.value = true;
  const { data, error } = await fetchPanelUsers();
  loading.value = false;
  if (!error && data) users.value = data.items;
}

async function toggleUser(u: PanelUser) {
  const { error } = await fetchSetUserEnabled(u.id, !u.disabled);
  if (!error) {
    ElMessage.success(u.disabled ? '已启用' : '已禁用');
    await load();
  }
}

async function removeUser(u: PanelUser) {
  await ElMessageBox.confirm(`确定删除用户 ${u.email} ? 该操作不可恢复。`, '删除确认', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  });
  const { error } = await fetchDeleteUser(u.id);
  if (!error) {
    ElMessage.success('已删除');
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="mb-12px flex-y-center justify-between">
      <span class="text-16px font-500">共 {{ users.length }} 个用户</span>
      <div class="flex gap-8px">
        <ElInput v-model="filter" placeholder="搜索邮箱…" clearable style="width: 280px" />
        <ElButton :loading="loading" @click="load">刷新</ElButton>
      </div>
    </div>

    <ElCard shadow="never" :body-style="{ padding: 0 }">
      <ElTable v-loading="loading" :data="filtered" stripe>
        <ElTableColumn prop="email" label="邮箱" min-width="220" show-overflow-tooltip />
        <ElTableColumn label="方式" width="90">
          <template #default="{ row }">
            <ElTag size="small" type="info" effect="plain">{{ row.provider }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="角色" width="90">
          <template #default="{ row }">
            <ElTag v-if="row.role === 'admin'" size="small" type="primary">admin</ElTag>
            <span v-else>—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="90">
          <template #default="{ row }">
            <ElTag v-if="row.disabled" size="small" type="danger">已禁用</ElTag>
            <ElTag v-else size="small" type="success">正常</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="注册时间" width="140">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="最近活跃" width="140">
          <template #default="{ row }">{{ fmtTime(row.lastSeenAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="160" align="right">
          <template #default="{ row }">
            <template v-if="row.role !== 'admin'">
              <ElButton size="small" @click="toggleUser(row)">{{ row.disabled ? '启用' : '禁用' }}</ElButton>
              <ElButton size="small" type="danger" plain @click="removeUser(row)">删除</ElButton>
            </template>
          </template>
        </ElTableColumn>
      </ElTable>
      <div v-if="!loading && filtered.length === 0" class="py-40px text-center text-14px text-gray-400">
        无匹配用户
      </div>
    </ElCard>
  </div>
</template>
