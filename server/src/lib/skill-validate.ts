/**
 * Skill 知识库防腐校验 v2 (后台巡检 API 用)
 * 与 skills/scripts/validate.mjs 同一套规则:
 * 结构/索引/代码锚点/死链 + 约束引用交叉校验 + 踩坑 hash git 验证 + 术语对照 schema
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SKILLS_DIR } from './skill-repo'

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(process.cwd(), '..')
const META = path.join(SKILLS_DIR, '_meta')

export interface ValidateReport {
  ok: boolean
  errors: string[]
  warns: string[]
  stats: { docs: number; skills: number; anchors: number }
}

export function validateSkills(): ValidateReport {
  const errors: string[] = []
  const warns: string[] = []
  const rel = (p: string) => path.relative(REPO_ROOT, p).replace(/\\/g, '/')
  if (!fs.existsSync(SKILLS_DIR)) {
    return { ok: false, errors: ['skills/ 目录不存在'], warns, stats: { docs: 0, skills: 0, anchors: 0 } }
  }

  const docs: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'scripts') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.md')) docs.push(full)
    }
  }
  walk(SKILLS_DIR)

  // 1. 结构 (_meta 不作为 skill)
  const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'scripts' && e.name !== '_meta')
    .map(e => e.name)
  for (const d of skillDirs) {
    const skillMd = path.join(SKILLS_DIR, d, 'SKILL.md')
    if (!fs.existsSync(skillMd)) { errors.push(`[结构] skills/${d}/ 缺少 SKILL.md`); continue }
    const raw = fs.readFileSync(skillMd, 'utf8')
    if (!/^---\r?\n[\s\S]*?\r?\n---/.test(raw)) errors.push(`[结构] skills/${d}/SKILL.md 缺少 frontmatter`)
    else if (!/^description:/m.test(raw)) errors.push(`[结构] skills/${d}/SKILL.md frontmatter 缺 description`)
  }

  // 2. 索引
  const agentsPath = path.join(SKILLS_DIR, 'AGENTS.md')
  if (!fs.existsSync(agentsPath)) errors.push('[索引] 缺少 skills/AGENTS.md')
  else {
    const agents = fs.readFileSync(agentsPath, 'utf8')
    for (const d of skillDirs) if (!agents.includes(d)) errors.push(`[索引] AGENTS.md 未收录 skill "${d}"`)
  }

  // 3/4. 锚点 + 死链
  const BASES = [REPO_ROOT, path.join(REPO_ROOT, 'admin-web'), path.join(REPO_ROOT, 'server')]
  const resolveCode = (f: string): string | null => {
    for (const b of BASES) { const a = path.join(b, f); if (fs.existsSync(a)) return a }
    return null
  }
  const CODE_RE = /`((?:src|server|admin-web|tests|scripts)\/[\w@./-]+(?:#[\w.-]+)?)`/g
  const LINK_RE = /\[[^\]]+\]\((\.{1,2}\/[^)#\s]+\.md)\)/g
  let anchors = 0
  for (const doc of docs) {
    const text = fs.readFileSync(doc, 'utf8')
    let m: RegExpExecArray | null
    while ((m = CODE_RE.exec(text))) {
      anchors++
      const [f, anchor] = m[1].split('#')
      const abs = resolveCode(f)
      if (!abs) { errors.push(`[锚点] ${rel(doc)} 引用的代码不存在: ${f}`); continue }
      if (anchor && fs.statSync(abs).isFile()) {
        const code = fs.readFileSync(abs, 'utf8')
        const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (!code.includes(anchor) && !new RegExp(`(function|const|class|def)\\s+${esc}\\b`).test(code))
          warns.push(`[锚点] ${rel(doc)} 中 ${f} 未找到符号 "${anchor}" (可能已重命名)`)
      }
    }
    const docDir = path.dirname(doc)
    let l: RegExpExecArray | null
    while ((l = LINK_RE.exec(text))) {
      if (!fs.existsSync(path.resolve(docDir, l[1]))) errors.push(`[死链] ${rel(doc)} 链接不存在: ${l[1]}`)
    }
  }

  // 5. 约束引用
  const constraintsPath = path.join(META, 'constraints.md')
  if (fs.existsSync(constraintsPath)) {
    const defined = new Set([...fs.readFileSync(constraintsPath, 'utf8').matchAll(/^## (C-\d+)/gm)].map(x => x[1]))
    for (const d of skillDirs) {
      const text = fs.readFileSync(path.join(SKILLS_DIR, d, 'SKILL.md'), 'utf8')
      const sec = /## 约束关联[\s\S]*?(?=\n## |\n$|$)/.exec(text)
      if (!sec) { errors.push(`[约束] skills/${d}/SKILL.md 缺少「约束关联」章节`); continue }
      for (const ref of sec[0].matchAll(/C-\d+/g)) {
        if (!defined.has(ref[0])) errors.push(`[约束] skills/${d}/SKILL.md 引用未定义的 ${ref[0]}`)
      }
    }
  } else errors.push('[约束] 缺少 skills/_meta/constraints.md')

  // 6. 踩坑 hash (同步 git 验证太重则降级为跳过, 与 CLI 版差异: API 内联校验)
  const pitfallsPath = path.join(META, 'pitfalls.md')

  // 7. 术语对照
  const glossaryPath = path.join(META, 'glossary.md')
  const schemaPath = path.join(REPO_ROOT, 'server/prisma/schema.prisma')
  if (fs.existsSync(glossaryPath) && fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8')
    const models = new Set([...schema.matchAll(/^model\s+(\w+)/gm)].map(x => x[1]))
    for (const g of fs.readFileSync(glossaryPath, 'utf8').matchAll(/Prisma:\s*`(\w+)`/g)) {
      if (!models.has(g[1])) errors.push(`[术语] _meta/glossary.md 的 \`${g[1]}\` 不在 schema.prisma 中`)
    }
  }
  void pitfallsPath

  return { ok: errors.length === 0, errors, warns, stats: { docs: docs.length, skills: skillDirs.length, anchors } }
}

/** 踩坑 hash git 验证 (异步, API 可选调用) */
export async function verifyPitfallHashes(): Promise<string[]> {
  const pitfallsPath = path.join(META, 'pitfalls.md')
  if (!fs.existsSync(pitfallsPath)) return ['[踩坑] 缺少 skills/_meta/pitfalls.md']
  const hashes = [...new Set([...fs.readFileSync(pitfallsPath, 'utf8').matchAll(/P-([0-9a-f]{7,40})/g)].map(x => x[1]))]
  const errs: string[] = []
  for (const h of hashes) {
    try { await execFileAsync('git', ['-C', REPO_ROOT, 'cat-file', '-e', h + '^{commit}']) }
    catch { errs.push(`[踩坑] _meta/pitfalls.md 的 P-${h} 在 git 中不存在`) }
  }
  return errs
}
