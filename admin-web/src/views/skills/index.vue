<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import DOMPurify from 'dompurify';
import {
  fetchSkills,
  fetchSkillFiles,
  fetchSkillFile,
  fetchSkillHistory,
  fetchSkillDiff,
  fetchSkillValidate,
  fetchSkillMeta
} from '@/service/api/skills';
import type { SkillMeta, SkillFileMeta, SkillCommit, SkillValidateReport, SkillMetaBundle } from '@/service/api/skills';
import { fmtTime2 } from '@/service/api/records';

defineOptions({ name: 'SkillsView' });

// ===== 数据 =====
const skills = ref<SkillMeta[]>([]);
const files = ref<SkillFileMeta[]>([]);
const loading = ref(false);
const activeFile = ref('');
const fileContent = ref('');
const fileMeta = ref<{ updatedAt: string | null; lastCommit: string | null }>({ updatedAt: null, lastCommit: null });
const history = ref<SkillCommit[]>([]);
const historyLoading = ref(false);
const renderedHtml = ref('');
const tab = ref<'doc' | 'history' | 'diff'>('doc');

// ===== diff 状态 =====
const diffFrom = ref('');
const diffTo = ref(''); // 空 = 工作区
const diffText = ref('');
const diffLoading = ref(false);

// ===== 巡检状态 =====
const report = ref<SkillValidateReport | null>(null);
const metaBundle = ref<SkillMetaBundle | null>(null);
const metaLoading = ref(false);
let metaLoaded = false;
const checkLoading = ref(false);

async function runCheck() {
  checkLoading.value = true;
  const { data, error } = await fetchSkillValidate();
  checkLoading.value = false;
  if (!error && data) report.value = data;
}

async function loadMeta() {
  metaLoading.value = true;
  const { data, error } = await fetchSkillMeta();
  metaLoading.value = false;
  if (!error && data) {
    metaBundle.value = data;
    metaLoaded = true;
  }
}

function openMeta() {
  activeFile.value = '_meta · 项目级要素';
  fileContent.value = '';
  renderedHtml.value = '';
  fileMeta.value = { updatedAt: null, lastCommit: null };
  tab.value = 'meta';
  if (!metaLoaded) loadMeta();
}

/** 简易 markdown → html (标题/列表/代码/表格/链接/粗体/行内代码) */
function renderMd(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc(md).split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let inTable = false;
  let listStack: string[] = [];
  const closeList = () => {
    while (listStack.length) html.push(`</${listStack.pop()}>`);
  };
  const closeTable = () => {
    if (inTable) { html.push('</tbody></table>'); inTable = false; }
  };
  const inline = (s: string) =>
    s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      closeTable();
      closeList();
      html.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { html.push(line); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeTable();
      closeList();
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\|.*\|$/.test(line.trim())) {
      const cells = line.trim().slice(1, -1).split('|');
      if (cells.every(c => /^:?-{2,}:?$/.test(c.trim()))) continue; // 分隔行
      if (!inTable) {
        closeList();
        html.push('<table><tbody>');
        inTable = true;
        html.push(`<tr>${cells.map(c => `<th>${inline(c.trim())}</th>`).join('')}</tr>`);
        continue;
      }
      html.push(`<tr>${cells.map(c => `<td>${inline(c.trim())}</td>`).join('')}</tr>`);
      continue;
    }
    closeTable();
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul) {
      if (listStack[listStack.length - 1] !== 'ul') { closeList(); html.push('<ul>'); listStack.push('ul'); }
      html.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    if (ol) {
      if (listStack[listStack.length - 1] !== 'ol') { closeList(); html.push('<ol>'); listStack.push('ol'); }
      html.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) { closeList(); html.push('<hr>'); continue; }
    closeList();
    if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  closeTable();
  if (inCode) html.push('</code></pre>');
  return html.join('\n');
}

// ===== 文件树分组 =====
interface FileNode {
  skill: string;
  children: SkillFileMeta[];
}
const fileGroups = computed<FileNode[]>(() => {
  const map = new Map<string, SkillFileMeta[]>();
  for (const f of files.value) {
    const skill = f.relPath.includes('/') ? f.relPath.split('/')[0] : '（全局索引）';
    if (!map.has(skill)) map.set(skill, []);
    map.get(skill)!.push(f);
  }
  return [...map.entries()].map(([skill, children]) => ({ skill, children }));
});

const activeSkill = computed(() => {
  if (!activeFile.value) return null;
  return skills.value.find(s => activeFile.value.startsWith(`${s.name}/`)) || null;
});

async function load() {
  loading.value = true;
  const [r1, r2] = await Promise.all([fetchSkills(), fetchSkillFiles()]);
  loading.value = false;
  if (!r1.error && r1.data) skills.value = r1.data.items;
  if (!r2.error && r2.data) {
    files.value = r2.data.items;
    if (!activeFile.value && r2.data.items.length) await openFile(r2.data.items[0].relPath);
  }
}

async function openFile(rel: string) {
  activeFile.value = rel;
  tab.value = 'doc';
  const { data, error } = await fetchSkillFile(rel);
  if (!error && data) {
    fileContent.value = data.content;
    fileMeta.value = { updatedAt: data.updatedAt, lastCommit: data.lastCommit };
    renderedHtml.value = DOMPurify.sanitize(renderMd(data.content));
    await loadHistory();
  }
}

async function loadHistory() {
  if (!activeFile.value) return;
  historyLoading.value = true;
  const { data, error } = await fetchSkillHistory(activeFile.value);
  historyLoading.value = false;
  if (!error && data) {
    history.value = data.items;
    if (data.items.length >= 1) {
      diffFrom.value = data.items[Math.min(1, data.items.length - 1)].hash;
      diffTo.value = data.items[0].hash;
    }
  }
}

async function loadDiff() {
  if (!activeFile.value || !diffFrom.value) return;
  diffLoading.value = true;
  const { data, error } = await fetchSkillDiff(activeFile.value, diffFrom.value, diffTo.value);
  diffLoading.value = false;
  if (!error && data) diffText.value = data.diff;
}

function onTab(name: string) {
  if (name === 'history') loadHistory();
  if (name === 'diff') loadDiff();
  if (name === 'check' && !report.value) runCheck();
  if (name === 'meta' && !metaLoaded) loadMeta();
}

function fmtDate(iso: string | null): string {
  if (!iso) return '未提交';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-del';
  if (line.startsWith('@@')) return 'diff-hunk';
  return '';
}

onMounted(load);
</script>

<template>
  <div class="min-h-500px flex gap-12px p-16px">
    <!-- 左侧: skill 列表 + 文件树 -->
    <div class="w-280px shrink-0">
      <el-card shadow="never">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-600">Skill 知识库</span>
            <el-button text size="small" :loading="loading" @click="load">刷新</el-button>
          </div>
        </template>
        <div v-if="skills.length" class="mb-12px">
          <div class="skill-desc">
            <el-collapse>
              <el-collapse-item v-for="s in skills" :key="s.name" :name="s.name">
                <template #title>
                  <el-tag size="small" :type="s.alwaysApply ? 'danger' : 'primary'" class="mr-6px">{{ s.name }}</el-tag>
                </template>
                <div class="text-12px text-gray-500 lh-relaxed">{{ s.description }}</div>
                <div v-if="s.globs.length" class="mt-4px text-11px text-gray-400">globs: {{ s.globs.join(', ') }}</div>
              </el-collapse-item>
            </el-collapse>
          </div>
        </div>
        <div class="mb-10px border-t border-gray-100 pt-8px">
          <div
            class="skill-file cursor-pointer rounded-4px px-8px py-4px text-13px"
            :class="{ 'bg-primary bg-opacity-10 text-primary font-600': tab === 'meta' }"
            @click="openMeta"
          >
            <div class="truncate font-600">项目级要素（_meta）</div>
            <div class="text-11px text-gray-400">约束 C-xx · 术语 T-xx · 踩坑 P-hash</div>
          </div>
        </div>
        <div v-for="g in fileGroups" :key="g.skill" class="mb-10px">
          <div class="mb-4px text-12px font-600 text-gray-500">{{ g.skill }}</div>
          <div
            v-for="f in g.children"
            :key="f.relPath"
            class="skill-file cursor-pointer rounded-4px px-8px py-4px text-13px"
            :class="{ 'bg-primary bg-opacity-10 text-primary font-600': activeFile === f.relPath }"
            @click="openFile(f.relPath)"
          >
            <div class="truncate">{{ f.relPath.split('/').slice(1).join('/') || f.relPath }}</div>
            <div class="text-11px text-gray-400">{{ fmtDate(f.updatedAt) }}</div>
          </div>
        </div>
        <el-empty v-if="!loading && !files.length" description="skills/ 目录为空" :image-size="60" />
      </el-card>
    </div>

    <!-- 右侧: 文档 / 迭代 / diff -->
    <el-card shadow="never" class="flex-1 overflow-hidden">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-600">{{ activeFile || '未选择文档' }}</span>
          <span v-if="fileMeta.updatedAt" class="text-12px text-gray-400">
            最近更新 {{ fmtDate(fileMeta.updatedAt) }} · {{ fileMeta.lastCommit }}
          </span>
        </div>
      </template>
      <el-tabs v-model="tab" @tab-change="onTab">
        <el-tab-pane label="文档" name="doc">
          <div class="md-body" v-html="renderedHtml" />
        </el-tab-pane>
        <el-tab-pane :label="`迭代历史${history.length ? `(${history.length})` : ''}`" name="history">
          <div v-loading="historyLoading">
            <el-timeline v-if="history.length" class="pl-8px pt-8px">
              <el-timeline-item
                v-for="c in history"
                :key="c.hash"
                :timestamp="`${fmtDate(c.date)} · ${c.author}`"
                placement="top"
                :type="c.status === 'A' ? 'success' : 'primary'"
              >
                <div class="text-13px">
                  <el-tag size="small" class="mr-6px">{{ c.hash }}</el-tag>
                  <el-tag v-if="c.status === 'A'" size="small" type="success" class="mr-6px">新建</el-tag>
                  {{ c.subject }}
                </div>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else-if="!historyLoading" description="暂无 git 迭代记录 (文档尚未提交)" :image-size="60" />
          </div>
        </el-tab-pane>
        <el-tab-pane label="版本对比" name="diff">
          <div class="mb-8px flex items-center gap-8px">
            <span class="text-12px text-gray-500">从</span>
            <el-select v-model="diffFrom" size="small" class="w-220px" placeholder="起始版本">
              <el-option v-for="c in history" :key="c.hash" :value="c.hash" :label="`${c.hash} ${c.subject.slice(0, 24)}`" />
            </el-select>
            <span class="text-12px text-gray-500">到</span>
            <el-select v-model="diffTo" size="small" class="w-220px" placeholder="工作区 (未提交)">
              <el-option value="" label="工作区 (未提交改动)" />
              <el-option v-for="c in history" :key="c.hash" :value="c.hash" :label="`${c.hash} ${c.subject.slice(0, 24)}`" />
            </el-select>
            <el-button size="small" type="primary" :loading="diffLoading" @click="loadDiff">对比</el-button>
          </div>
          <pre v-if="diffText" class="diff-view"><code><span v-for="(l, i) in diffText.split('\n')" :key="i" :class="diffLineClass(l)">{{ l || ' ' }}</span></code></pre>
          <el-empty v-else-if="!diffLoading" description="选择版本后点击对比" :image-size="60" />
        </el-tab-pane>
        <el-tab-pane label="健康巡检" name="check">
          <div class="mb-12px flex items-center gap-12px">
            <el-button type="primary" size="small" :loading="checkLoading" @click="runCheck">运行巡检</el-button>
            <span v-if="report" class="text-12px" :class="report.ok ? 'text-green-600' : 'text-red-500'">
              {{ report.ok ? '✓ 通过' : `✗ ${report.errors.length} 个错误` }}
              · {{ report.stats.skills }} skills / {{ report.stats.docs }} 文档 / {{ report.stats.anchors }} 代码锚点
            </span>
            <span v-else class="text-12px text-gray-400">校验: 结构完整 / 索引同步 / 代码锚点存在 / 文档死链</span>
          </div>
          <template v-if="report">
            <el-alert v-if="report.ok && !report.warns.length" type="success" :closable="false" title="知识库健康: 无漂移" />
            <div v-for="(e, i) in report.errors" :key="'e' + i" class="mb-4px rounded-4px bg-red-50 px-10px py-6px text-13px text-red-600">{{ e }}</div>
            <div v-for="(w, i) in report.warns" :key="'w' + i" class="mb-4px rounded-4px bg-orange-50 px-10px py-6px text-13px text-orange-500">{{ w }}</div>
          </template>
          <el-empty v-else-if="!checkLoading" description="点击「运行巡检」检查文档与代码的漂移" :image-size="60" />
        </el-tab-pane>
        <el-tab-pane label="要素总览" name="meta">
          <div v-loading="metaLoading">
            <template v-if="metaBundle">
              <div class="mb-8px flex items-center gap-8px">
                <el-tag type="danger" size="small">不可变约束</el-tag>
                <span class="text-12px text-gray-400">{{ metaBundle.constraints.length }} 条 · 最近更新 {{ fmtDate(metaBundle.files.constraints.updatedAt) }} · {{ metaBundle.files.constraints.lastCommit }}</span>
              </div>
              <el-collapse class="mb-16px">
                <el-collapse-item v-for="c in metaBundle.constraints" :key="c.id" :name="c.id">
                  <template #title>
                    <el-tag size="small" type="danger" effect="plain" class="mr-6px">{{ c.id }}</el-tag>
                    <span class="text-13px font-600">{{ c.title }}</span>
                  </template>
                  <div v-for="(it, i) in c.items" :key="i" class="mb-2px text-13px">
                    <span v-if="it.k" class="text-gray-500">{{ it.k }}：</span><span>{{ it.v }}</span>
                  </div>
                </el-collapse-item>
              </el-collapse>

              <div class="mb-8px flex items-center gap-8px">
                <el-tag type="primary" size="small">名词对象</el-tag>
                <span class="text-12px text-gray-400">{{ metaBundle.glossary.length }} 个 · 最近更新 {{ fmtDate(metaBundle.files.glossary.updatedAt) }} · {{ metaBundle.files.glossary.lastCommit }}</span>
              </div>
              <el-table :data="metaBundle.glossary" size="small" class="mb-16px" max-height="320">
                <el-table-column prop="id" label="ID" width="170" />
                <el-table-column prop="prisma" label="Prisma 模型" width="200" />
                <el-table-column prop="title" label="术语" width="130" />
                <el-table-column prop="desc" label="说明" show-overflow-tooltip />
              </el-table>

              <div class="mb-8px flex items-center gap-8px">
                <el-tag type="warning" size="small">踩坑记录</el-tag>
                <span class="text-12px text-gray-400">{{ metaBundle.pitfalls.length }} 条 · 最近更新 {{ fmtDate(metaBundle.files.pitfalls.updatedAt) }} · {{ metaBundle.files.pitfalls.lastCommit }}</span>
              </div>
              <el-collapse>
                <el-collapse-item v-for="p in metaBundle.pitfalls" :key="p.id" :name="p.id">
                  <template #title>
                    <el-tag size="small" type="warning" effect="plain" class="mr-6px">{{ p.id }}</el-tag>
                    <span class="text-13px">{{ p.title }}</span>
                    <el-tag size="small" effect="plain" class="ml-6px">{{ p.module }}</el-tag>
                  </template>
                  <div v-for="(it, j) in p.items" :key="j" class="mb-2px text-13px">
                    <span v-if="it.k" class="text-gray-500">{{ it.k }}：</span><span>{{ it.v }}</span>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </template>
            <el-empty v-else-if="!metaLoading" description="暂无数据" :image-size="60" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<style scoped>
.skill-file:hover {
  background: rgba(0, 0, 0, 0.04);
}

.skill-desc :deep(.el-collapse-item__header) {
  height: 32px;
}

.md-body {
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.7;
}

.md-body :deep(h1) {
  font-size: 20px;
  font-weight: 600;
  margin: 8px 0 12px;
}

.md-body :deep(h2) {
  font-size: 16px;
  font-weight: 600;
  margin: 16px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.md-body :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  margin: 12px 0 6px;
}

.md-body :deep(p) {
  margin: 6px 0;
}

.md-body :deep(ul),
.md-body :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}

.md-body :deep(code) {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 13px;
}

.md-body :deep(pre code) {
  display: block;
  padding: 10px;
  background: rgba(0, 0, 0, 0.04);
  overflow-x: auto;
}

.md-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}

.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid rgba(0, 0, 0, 0.12);
  padding: 4px 10px;
  text-align: left;
}

.md-body :deep(th) {
  background: rgba(0, 0, 0, 0.04);
  font-weight: 600;
}

.md-body :deep(a) {
  color: var(--el-color-primary);
}

.md-body :deep(hr) {
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  margin: 12px 0;
}

.diff-view {
  max-height: calc(100vh - 320px);
  overflow: auto;
  background: rgba(0, 0, 0, 0.03);
  padding: 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
}

.diff-view span {
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-add {
  background: rgba(103, 194, 58, 0.15);
  color: #529b2e;
}

.diff-del {
  background: rgba(245, 108, 108, 0.15);
  color: #c45656;
}

.diff-hunk {
  color: #909399;
  font-weight: 600;
}
</style>
