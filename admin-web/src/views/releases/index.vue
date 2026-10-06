<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { fetchReleases, fetchCreateRelease, fetchDeleteRelease, fetchSyncReleases, fmtTime2 } from '@/service/api/records';
import type { ReleaseItem } from '@/service/api/records';

defineOptions({ name: 'ReleasesView' });

const list = ref<ReleaseItem[]>([]);
const loading = ref(false);
const dialogVisible = ref(false);
const form = ref({ version: '', title: '', notes: '' });

async function load() {
  loading.value = true;
  const { data, error } = await fetchReleases();
  loading.value = false;
  if (!error && data) list.value = data;
}

const syncing = ref(false);
async function onSync() {
  syncing.value = true;
  const { data, error } = await fetchSyncReleases();
  syncing.value = false;
  if (!error && data) {
    ElMessage.success(`已同步 ${data.synced} 条`);
    await load();
  } else if (error) {
    ElMessage.error('同步失败');
  }
}
function openCreate() {
  form.value = { version: '', title: '', notes: '' };
  dialogVisible.value = true;
}

async function submit() {
  if (!form.value.version.trim()) {
    ElMessage.warning('请填写版本号');
    return;
  }
  const { error } = await fetchCreateRelease({ ...form.value });
  if (!error) {
    ElMessage.success('已保存');
    dialogVisible.value = false;
    await load();
  }
}

async function remove(row: ReleaseItem) {
  await ElMessageBox.confirm(`确定删除版本 ${row.version} 的记录？`, '删除确认', { type: 'warning' });
  const { error } = await fetchDeleteRelease(row.id);
  if (!error) {
    ElMessage.success('已删除');
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="min-h-500px p-16px">
    <div class="mb-12px flex items-center justify-between">
      <div class="text-16px font-600">版本更新记录</div>
      <el-button :loading="syncing" @click="onSync">同步</el-button>
      <el-button type="primary" @click="openCreate">手动添加版本</el-button>
    </div>

    <el-table v-loading="loading" :data="list" stripe>
      <el-table-column prop="version" label="版本号" width="120">
        <template #default="{ row }">
          <el-tag>v{{ row.version }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="180" />
      <el-table-column prop="notes" label="说明" min-width="260" show-overflow-tooltip />
      <el-table-column label="来源" width="90">
        <template #default="{ row }">
          <el-tag :type="row.source === 'auto' ? 'success' : 'info'" size="small">
            {{ row.source === 'auto' ? '自动' : '手动' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="140">
        <template #default="{ row }">{{ fmtTime2(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>暂无版本记录</template>
    </el-table>

    <el-dialog v-model="dialogVisible" title="添加版本记录" width="480px">
      <el-form label-width="70px">
        <el-form-item label="版本号" required>
          <el-input v-model="form.version" placeholder="如 0.2.0 (不带 v 前缀)" />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="如: 新增导出功能" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.notes" type="textarea" :rows="4" placeholder="更新内容说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

