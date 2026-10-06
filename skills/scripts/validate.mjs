#!/usr/bin/env node
/**
 * Skill 知识库防腐校验器
 *
 * 校验内容 (对应文章四层防腐中的「反向校验」与「基线巡检」):
 *  1. 结构完整: 每个 skills/<name>/ 有 SKILL.md, frontmatter 含 name/description
 *  2. 索引同步: skills/AGENTS.md 索引表覆盖全部 skill
 *  3. 代码锚点: SKILL.md/references 中引用的代码路径 (形如 src/... 或 server/... 的反引号片段) 真实存在
 *  4. 死链检查: 文档间相对链接指向的 md 文件存在
 *
 * 用法: node skills/scripts/validate.mjs [--json]
 * 退出码: 0 = 通过, 1 = 有错误 (可挂 pre-commit)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILLS = path.join(ROOT, 'skills');

const errors = [];
const warns = [];

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

// ---- 收集文档 ----
const docs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'scripts') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.md')) docs.push(full);
  }
})(SKILLS);

// ---- 1. 结构完整 + frontmatter ----
const skillDirs = fs.existsSync(SKILLS)
  ? fs.readdirSync(SKILLS, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'scripts').map(e => e.name)
  : [];

for (const d of skillDirs) {
  const skillMd = path.join(SKILLS, d, 'SKILL.md');
  if (!fs.existsSync(skillMd)) {
    errors.push(`[结构] skills/${d}/ 缺少 SKILL.md`);
    continue;
  }
  const raw = fs.readFileSync(skillMd, 'utf8');
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(raw)) errors.push(`[结构] skills/${d}/SKILL.md 缺少 frontmatter`);
  if (!/^description:/m.test(raw)) errors.push(`[结构] skills/${d}/SKILL.md frontmatter 缺 description`);
}

// ---- 2. 索引同步 ----
const agentsPath = path.join(SKILLS, 'AGENTS.md');
if (!fs.existsSync(agentsPath)) {
  errors.push('[索引] 缺少 skills/AGENTS.md');
} else {
  const agents = fs.readFileSync(agentsPath, 'utf8');
  for (const d of skillDirs) {
    if (!agents.includes(d)) errors.push(`[索引] AGENTS.md 未收录 skill "${d}"`);
  }
}

// ---- 3. 代码锚点存在性 ----
// 匹配反引号包裹的代码路径: src/xxx server/xxx admin-web/xxx tests/xxx, 可带 #anchor
// 路径基准: 文档里的相对路径可能相对仓库根 / admin-web / server (monorepo), 逐个基准探测
const BASES = [ROOT, path.join(ROOT, 'admin-web'), path.join(ROOT, 'server')];
function resolveCodePath(filePart) {
  for (const b of BASES) {
    const abs = path.join(b, filePart);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}
const CODE_RE = /`((?:src|server|admin-web|tests|scripts)\/[\w@./-]+(?:#[\w.-]+)?)`/g;
let anchorCount = 0;
for (const doc of docs) {
  const text = fs.readFileSync(doc, 'utf8');
  let m;
  while ((m = CODE_RE.exec(text))) {
    anchorCount++;
    const ref = m[1];
    const [filePart, anchor] = ref.split('#');
    const abs = resolveCodePath(filePart);
    if (!abs) {
      errors.push(`[锚点] ${rel(doc)} 引用的代码不存在: ${filePart}`);
      continue;
    }
    if (anchor && fs.statSync(abs).isFile()) {
      const code = fs.readFileSync(abs, 'utf8');
      const found = code.includes(anchor) ||
        new RegExp(`(function|const|class|def)\\s+${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(code);
      if (!found) warns.push(`[锚点] ${rel(doc)} 中 ${filePart} 未找到符号 "${anchor}" (可能已重命名)`);
    }
  }

  // ---- 4. 文档间相对链接 ----
  const LINK_RE = /\[[^\]]+\]\((\.{1,2}\/[^)#\s]+\.md)\)/g;
  const docDir = path.dirname(doc);
  let l;
  while ((l = LINK_RE.exec(text))) {
    const target = path.resolve(docDir, l[1]);
    if (!fs.existsSync(target)) errors.push(`[死链] ${rel(doc)} 链接不存在: ${l[1]}`);
  }
}

const report = { ok: errors.length === 0, errors, warns, stats: { docs: docs.length, skills: skillDirs.length, anchors: anchorCount } };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`校验 ${report.stats.skills} 个 skill / ${report.stats.docs} 个文档 / ${report.stats.anchors} 个代码锚点`);
  for (const e of errors) console.log('  ✗', e);
  for (const w of warns) console.log('  ⚠', w);
  console.log(errors.length ? `FAIL: ${errors.length} 个错误` : 'PASS');
}
process.exit(errors.length ? 1 : 0);
