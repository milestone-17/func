#!/usr/bin/env node
/**
 * Skill 知识库防腐校验器 v2
 *
 * 校验内容:
 *  1. 结构完整: skills/<name>/SKILL.md + frontmatter (name/description)
 *  2. 索引同步: AGENTS.md 收录全部 skill
 *  3. 代码锚点: 反引号路径存在 (monorepo 多基准), #符号 可定位
 *  4. 死链检查: 文档间相对链接存在
 *  5. 约束引用: SKILL.md「约束关联」引用的 C-xx 必须在 _meta/constraints.md 定义
 *  6. 踩坑 hash: _meta/pitfalls.md 的 P-<hash> 必须 git 真实存在
 *  7. 术语对照: _meta/glossary.md 的 `Model` 名必须在 schema.prisma 中存在
 *
 * 用法: node skills/scripts/validate.mjs [--json]
 * _meta/ 为项目级元知识目录, 不作为独立 skill 校验结构
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILLS = path.join(ROOT, 'skills');
const META = path.join(SKILLS, '_meta');

const errors = [];
const warns = [];

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

// ---- 收集文档 (_meta 特殊: 参与锚点/死链校验, 不做 skill 结构校验) ----
const docs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'scripts') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.md')) docs.push(full);
  }
})(SKILLS);

// ---- 1. 结构完整 ----
const skillDirs = fs.readdirSync(SKILLS, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'scripts' && e.name !== '_meta')
  .map(e => e.name);

for (const d of skillDirs) {
  const skillMd = path.join(SKILLS, d, 'SKILL.md');
  if (!fs.existsSync(skillMd)) { errors.push(`[结构] skills/${d}/ 缺少 SKILL.md`); continue; }
  const raw = fs.readFileSync(skillMd, 'utf8');
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(raw)) errors.push(`[结构] skills/${d}/SKILL.md 缺少 frontmatter`);
  else if (!/^description:/m.test(raw)) errors.push(`[结构] skills/${d}/SKILL.md frontmatter 缺 description`);
}

// ---- 2. 索引同步 ----
const agentsPath = path.join(SKILLS, 'AGENTS.md');
if (!fs.existsSync(agentsPath)) errors.push('[索引] 缺少 skills/AGENTS.md');
else {
  const agents = fs.readFileSync(agentsPath, 'utf8');
  for (const d of skillDirs) if (!agents.includes(d)) errors.push(`[索引] AGENTS.md 未收录 skill "${d}"`);
}

// ---- 3/4. 代码锚点 + 死链 ----
const BASES = [ROOT, path.join(ROOT, 'admin-web'), path.join(ROOT, 'server')];
function resolveCode(f) { for (const b of BASES) { const a = path.join(b, f); if (fs.existsSync(a)) return a; } return null; }
const CODE_RE = /`((?:src|server|admin-web|tests|scripts)\/[\w@./-]+(?:#[\w.-]+)?)`/g;
const LINK_RE = /\[[^\]]+\]\((\.{1,2}\/[^)#\s]+\.md)\)/g;
let anchorCount = 0;
for (const doc of docs) {
  const text = fs.readFileSync(doc, 'utf8');
  let m;
  while ((m = CODE_RE.exec(text))) {
    anchorCount++;
    const [f, anchor] = m[1].split('#');
    const abs = resolveCode(f);
    if (!abs) { errors.push(`[锚点] ${rel(doc)} 引用的代码不存在: ${f}`); continue; }
    if (anchor && fs.statSync(abs).isFile()) {
      const code = fs.readFileSync(abs, 'utf8');
      const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!code.includes(anchor) && !new RegExp(`(function|const|class|def)\\s+${esc}\\b`).test(code))
        warns.push(`[锚点] ${rel(doc)} 中 ${f} 未找到符号 "${anchor}" (可能已重命名)`);
    }
  }
  const docDir = path.dirname(doc);
  let l;
  while ((l = LINK_RE.exec(text))) {
    if (!fs.existsSync(path.resolve(docDir, l[1]))) errors.push(`[死链] ${rel(doc)} 链接不存在: ${l[1]}`);
  }
}

// ---- 5. 约束引用交叉校验 ----
const constraintsPath = path.join(META, 'constraints.md');
if (fs.existsSync(constraintsPath)) {
  const defined = new Set([...fs.readFileSync(constraintsPath, 'utf8').matchAll(/^## (C-\d+)/gm)].map(x => x[1]));
  for (const d of skillDirs) {
    const p = path.join(SKILLS, d, 'SKILL.md');
    const text = fs.readFileSync(p, 'utf8');
    const sec = /## 约束关联[\s\S]*?(?=\n## |\n$|$)/.exec(text);
    if (!sec) { errors.push(`[约束] skills/${d}/SKILL.md 缺少「约束关联」章节`); continue; }
    for (const ref of sec[0].matchAll(/C-\d+/g)) {
      if (!defined.has(ref[0])) errors.push(`[约束] skills/${d}/SKILL.md 引用未定义的 ${ref[0]}`);
    }
  }
} else {
  errors.push('[约束] 缺少 skills/_meta/constraints.md');
}

// ---- 6. 踩坑 hash git 验证 ----
const pitfallsPath = path.join(META, 'pitfalls.md');
if (fs.existsSync(pitfallsPath)) {
  const pt = fs.readFileSync(pitfallsPath, 'utf8');
  const hashes = [...new Set([...pt.matchAll(/P-([0-9a-f]{7,40})/g)].map(x => x[1]))];
  for (const h of hashes) {
    try { execFileSync('git', ['-C', ROOT, 'cat-file', '-e', h + '^{commit}'], { stdio: 'pipe' }); }
    catch { errors.push(`[踩坑] _meta/pitfalls.md 的 P-${h} 在 git 中不存在`); }
  }
} else {
  errors.push('[踩坑] 缺少 skills/_meta/pitfalls.md');
}

// ---- 7. 术语对照 schema ----
const glossaryPath = path.join(META, 'glossary.md');
const schemaPath = path.join(ROOT, 'server/prisma/schema.prisma');
if (fs.existsSync(glossaryPath) && fs.existsSync(schemaPath)) {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const models = new Set([...schema.matchAll(/^model\s+(\w+)/gm)].map(x => x[1]));
  for (const g of fs.readFileSync(glossaryPath, 'utf8').matchAll(/Prisma:\s*`(\w+)`/g)) {
    if (!models.has(g[1])) errors.push(`[术语] _meta/glossary.md 的 \`${g[1]}\` 不在 schema.prisma 中`);
  }
}

const report = { ok: errors.length === 0, errors, warns, stats: { docs: docs.length, skills: skillDirs.length, anchors: anchorCount } };
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`校验 ${report.stats.skills} 个 skill / ${report.stats.docs} 个文档 / ${report.stats.anchors} 个代码锚点 (含约束/踩坑/术语交叉校验)`);
  for (const e of errors) console.log('  ✗', e);
  for (const w of warns) console.log('  ⚠', w);
  console.log(errors.length ? `FAIL: ${errors.length} 个错误` : 'PASS');
}
process.exit(errors.length ? 1 : 0);
