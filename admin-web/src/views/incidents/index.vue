<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchIncidents, fetchCreateIncident, fetchUpdateIncident, fetchDeleteIncident, fetchSyncIncidents,
  fmtTime2, severityTagType, severityLabel
} from '@/service/api/records';
import type { IncidentItem } from '@/service/api/records';

defineOptions({ name: 'IncidentsView' });

const list = ref<IncidentItem[]>([]);
const loading = ref(false);
const dialogVisible = ref(false);
const editing = ref<IncidentItem | null>(null);
const form = ref({ title: '', content: '', severity: 'medium' });

async function load() {
  loading.value = true;
  const { data, error } = await fetchIncidents();
  loading.value = false;
  if (!error && data) list.value = data;
}

const syncing = ref(false);
async function onSync() {
  syncing.value = true;
  const { data, error } = await fetchSyncIncidents();
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
  form.value = { title: '', content: '', severity: 'medium' };
  dialogVisible.value = true;
}

function openEdit(row: IncidentItem) {
  editing.value = row;
  form.value = { title: row.title, content: row.content, severity: row.severity };
  dialogVisible.value = true;
}

async function submit() {
  if (!form.value.title.trim()) {
    ElMessage.warning('请填写标题');
    return;
  }
  const { error } = editing.value
    ? await fetchUpdateIncident(editing.value.id, { ...form.value })
    : await fetchCreateIncident({ ...form.value });
  if (!error) {
    ElMessage.success('已保存');
    dialogVisible.value = false;
    await load();
  }
}

async function resolve(row: IncidentItem) {
  const status = row.status === 'resolved' ? 'open' : 'resolved';
  const { error } = await fetchUpdateIncident(row.id, { status });
  if (!error) {
    ElMessage.success(status === 'resolved' ? '已标记为已恢复' : '已重新打开');
    await load();
  }
}

async function remove(row: IncidentItem) {
  await ElMessageBox.confirm(`确定删除「${row.title}」？`, '删除确认', { type: 'warning' });
  const { error } = await fetchDeleteIncident(row.id);
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
      <div class="text-16px font-600">线上事故记录</div>
      <el-button :loading="syncing" @click="onSync">同步</el-button>
      <el-button type="primary" @click="openCreate">登记事故</el-button>
    </div>

    <el-table v-loading="loading" :data="list" stripe>
      <el-table-column prop="title" label="事故" min-width="220" show-overflow-tooltip />
      <el-table-column prop="content" label="详情" min-width="260" show-overflow-tooltip />
      <el-table-column label="严重度" width="90">
        <template #default="{ row }">
          <el-tag :type="severityTagType(row.severity)" size="small">{{ severityLabel[row.severity] || row.severity }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'resolved' ? 'success' : 'danger'" size="small">
            {{ row.status === 'resolved' ? '已恢复' : '处理中' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="发生时间" width="140">
        <template #default="{ row }">{{ fmtTime2(row.startedAt) }}</template>
      </el-table-column>
      <el-table-column label="恢复时间" width="140">
        <template #default="{ row }">{{ fmtTime2(row.resolvedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link :type="row.status === 'resolved' ? 'warning' : 'success'" size="small" @click="resolve(row)">
            {{ row.status === 'resolved' ? '重开' : '恢复' }}
          </el-button>
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>暂无事故记录</template>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑事故' : '登记事故'" width="560px">
      <el-form label-width="70px">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" placeholder="事故概括" />
        </el-form-item>
        <el-form-item label="详情">
          <el-input v-model="form.content" type="textarea" :rows="5" placeholder="影响范围、原因、处理过程、复盘" />
        </el-form-item>
        <el-form-item label="严重度">
          <el-radio-group v-model="form.severity">
            <el-radio value="low">轻微</el-radio>
            <el-radio value="medium">中等</el-radio>
            <el-radio value="high">严重</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

