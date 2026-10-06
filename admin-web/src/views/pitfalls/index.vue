<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchPitfalls, fetchCreatePitfall, fetchUpdatePitfall, fetchDeletePitfall, fetchSyncPitfalls,
  fmtTime2, severityTagType, severityLabel
} from '@/service/api/records';
import type { PitfallItem } from '@/service/api/records';

defineOptions({ name: 'PitfallsView' });

const list = ref<PitfallItem[]>([]);
const loading = ref(false);
const dialogVisible = ref(false);
const editing = ref<PitfallItem | null>(null);
const form = ref({ title: '', content: '', severity: 'medium', resolved: false });

async function load() {
  loading.value = true;
  const { data, error } = await fetchPitfalls();
  loading.value = false;
  if (!error && data) list.value = data;
}

const syncing = ref(false);
async function onSync() {
  syncing.value = true;
  const { data, error } = await fetchSyncPitfalls();
  syncing.value = false;
  if (!error && data) {
    ElMessage.success(`已同步 ${data.synced} 条`);
    await load();
  } else if (error) {
    ElMessage.error('同步失败');
  }
}
function openCreate() {
  editing.value = null;
  form.value = { title: '', content: '', severity: 'medium', resolved: false };
  dialogVisible.value = true;
}

function openEdit(row: PitfallItem) {
  editing.value = row;
  form.value = { title: row.title, content: row.content, severity: row.severity, resolved: row.resolved };
  dialogVisible.value = true;
}

async function submit() {
  if (!form.value.title.trim()) {
    ElMessage.warning('请填写标题');
    return;
  }
  const { error } = editing.value
    ? await fetchUpdatePitfall(editing.value.id, { ...form.value })
    : await fetchCreatePitfall({ ...form.value });
  if (!error) {
    ElMessage.success('已保存');
    dialogVisible.value = false;
    await load();
  }
}

async function toggleResolved(row: PitfallItem) {
  const { error } = await fetchUpdatePitfall(row.id, { resolved: !row.resolved });
  if (!error) {
    ElMessage.success(row.resolved ? '已标记为未解决' : '已标记为已解决');
    await load();
  }
}

async function remove(row: PitfallItem) {
  await ElMessageBox.confirm(`确定删除「${row.title}」？`, '删除确认', { type: 'warning' });
  const { error } = await fetchDeletePitfall(row.id);
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
      <div class="text-16px font-600">开发坑与严重 Bug</div>
      <el-button :loading="syncing" @click="onSync">同步</el-button>
      <el-button type="primary" @click="openCreate">记录新坑</el-button>
    </div>

    <el-table v-loading="loading" :data="list" stripe>
      <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
      <el-table-column prop="content" label="详情" min-width="280" show-overflow-tooltip />
      <el-table-column label="严重度" width="90">
        <template #default="{ row }">
          <el-tag :type="severityTagType(row.severity)" size="small">{{ severityLabel[row.severity] || row.severity }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.resolved ? 'success' : 'warning'" size="small">{{ row.resolved ? '已解决' : '未解决' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="记录时间" width="140">
        <template #default="{ row }">{{ fmtTime2(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="success" size="small" @click="toggleResolved(row)">
            {{ row.resolved ? '重开' : '解决' }}
          </el-button>
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>暂无记录</template>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑记录' : '记录新坑'" width="560px">
      <el-form label-width="70px">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" placeholder="一句话概括踩到的坑" />
        </el-form-item>
        <el-form-item label="详情">
          <el-input v-model="form.content" type="textarea" :rows="5" placeholder="现象、原因、解决方案" />
        </el-form-item>
        <el-form-item label="严重度">
          <el-radio-group v-model="form.severity">
            <el-radio value="low">轻微</el-radio>
            <el-radio value="medium">中等</el-radio>
            <el-radio value="high">严重</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.resolved" active-text="已解决" inactive-text="未解决" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

