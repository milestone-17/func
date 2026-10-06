/**
 * Skill 知识库防腐校验 (后台巡检 API 用)
 * 与 skills/scripts/validate.mjs 同一套规则: 结构完整/索引同步/代码锚点/死链
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SKILLS_DIR } from './skill-repo'

const REPO_ROOT = path.resolve(process.cwd(), '..')

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

  // 收集文档 (跳过 scripts)
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

  // 1. 结构完整
  const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'scripts')
    .map(e => e.name)
  for (const d of skillDirs) {
    const skillMd = path.join(SKILLS_DIR, d, 'SKILL.md')
    if (!fs.existsSync(skillMd)) { errors.push(`[结构] skills/${d}/ 缺少 SKILL.md`); continue }
    const raw = fs.readFileSync(skillMd, 'utf8')
    if (!/^---\r?\n[\s\S]*?\r?\n---/.test(raw)) errors.push(`[结构] skills/${d}/SKILL.md 缺少 frontmatter`)
    else if (!/^description:/m.test(raw)) errors.push(`[结构] skills/${d}/SKILL.md frontmatter 缺 description`)
  }

  // 2. 索引同步
  const agentsPath = path.join(SKILLS_DIR, 'AGENTS.md')
  if (!fs.existsSync(agentsPath)) {
    errors.push('[索引] 缺少 skills/AGENTS.md')
  } else {
    const agents = fs.readFileSync(agentsPath, 'utf8')
    for (const d of skillDirs) {
      if (!agents.includes(d)) errors.push(`[索引] AGENTS.md 未收录 skill "${d}"`)
    }
  }

  // 3. 代码锚点 (monorepo 多基准)
  const BASES = [REPO_ROOT, path.join(REPO_ROOT, 'admin-web'), path.join(REPO_ROOT, 'server')]
  const resolveCode = (f: string): string | null => {
    for (const b of BASES) {
      const abs = path.join(b, f)
      if (fs.existsSync(abs)) return abs
    }
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
      const [filePart, anchor] = m[1].split('#')
      const abs = resolveCode(filePart)
      if (!abs) { errors.push(`[锚点] ${rel(doc)} 引用的代码不存在: ${filePart}`); continue }
      if (anchor && fs.statSync(abs).isFile()) {
        const code = fs.readFileSync(abs, 'utf8')
        const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (!code.includes(anchor) && !new RegExp(`(function|const|class|def)\\s+${esc}\\b`).test(code)) {
          warns.push(`[锚点] ${rel(doc)} 中 ${filePart} 未找到符号 "${anchor}" (可能已重命名)`)
        }
      }
    }
    // 4. 文档间死链
    const docDir = path.dirname(doc)
    let l: RegExpExecArray | null
    while ((l = LINK_RE.exec(text))) {
      if (!fs.existsSync(path.resolve(docDir, l[1]))) errors.push(`[死链] ${rel(doc)} 链接不存在: ${l[1]}`)
    }
  }

  return { ok: errors.length === 0, errors, warns, stats: { docs: docs.length, skills: skillDirs.length, anchors } }
}
