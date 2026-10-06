/**
 * Skill 知识库仓库层
 *
 * 目录约定 (仓库根 skills/):
 *   AGENTS.md                      全局索引 (L1)
 *   <skill-name>/SKILL.md          skill 主文件 (L2, frontmatter 元数据)
 *   <skill-name>/references/*.md   按需加载详情 (L3)
 *   <skill-name>/scripts/*         可选脚本
 *
 * 迭代历史依赖 git: 每次知识变更产生 commit, 用 git log --follow 重建时间线。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const SKILLS_DIR = path.resolve(process.cwd(), '../skills')
const REPO_DIR = path.resolve(process.cwd(), '..')

export interface SkillMeta {
  name: string
  description: string
  globs: string[]
  alwaysApply: boolean
}

export interface SkillFile {
  /** 相对 skills/ 的路径, 如 finance-domain/SKILL.md */
  relPath: string
  /** 所属 skill 名 (AGENTS.md 为 '__index__') */
  skill: string
  title: string
  /** 最近的 git commit 时间 (ISO), 未知为 null */
  updatedAt: string | null
  /** 最近一次变更的提交摘要 */
  lastCommit: string | null
}

export interface SkillCommit {
  hash: string
  date: string
  author: string
  subject: string
  /** 该 commit 中此文件的变更类型 */
  status: string
}

/** 解析 markdown frontmatter (--- 包裹的 yaml 子集: key: value / key: [a, b]) */
export function parseFrontmatter(raw: string): { meta: Record<string, string | string[] | boolean>; body: string } {
  const meta: Record<string, string | string[] | boolean> = {}
  let body = raw
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (m) {
    body = raw.slice(m[0].length)
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim())
      if (!kv) continue
      const [, k, vRaw] = kv
      const v = vRaw.trim()
      if (v.startsWith('[') && v.endsWith(']')) {
        meta[k] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      } else if (v === 'true' || v === 'false') {
        meta[k] = v === 'true'
      } else {
        meta[k] = v.replace(/^['"]|['"]$/g, '')
      }
    }
  }
  return { meta, body }
}

/** 提取 markdown 第一个 # 标题作为 title */
export function extractTitle(md: string): string {
  const m = /^#\s+(.+)$/m.exec(md)
  return m ? m[1].trim() : ''
}

function safeJoin(rel: string): string | null {
  const p = path.normalize(rel).replace(/^([.][.][/\\])+/, '')
  const abs = path.join(SKILLS_DIR, p)
  if (!abs.startsWith(SKILLS_DIR)) return null
  return abs
}

/** 递归列出 skills/ 下全部 .md 文件 (相对路径), 不存在返回 [] */
export function listSkillFiles(): string[] {
  if (!fs.existsSync(SKILLS_DIR)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(path.relative(SKILLS_DIR, full).replace(/\\/g, '/'))
    }
  }
  walk(SKILLS_DIR)
  return out.sort()
}

/** git log --follow 单文件迭代历史 (失败返回空) */
export async function fileHistory(rel: string, limit = 100): Promise<SkillCommit[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', REPO_DIR, 'log', '--follow', '--name-status', '--pretty=format:%h%x1f%ci%x1f%an%x1f%s%x1e', `-${limit}`, '--', `skills/${rel}`]
    )
    const out: SkillCommit[] = []
    for (const seg of stdout.split('\u001e')) {
      const trimmed = seg.replace(/^\n/, '')
      if (!trimmed.trim()) continue
      const nl = trimmed.indexOf('\n')
      const headPart = (nl === -1 ? trimmed : trimmed.slice(0, nl)).split('\u001f')
      const statusPart = nl === -1 ? '' : trimmed.slice(nl + 1).trim()
      const status = statusPart.split('\t')[0] || 'M'
      out.push({
        hash: headPart[0] || '',
        date: headPart[1] || '',
        author: headPart[2] || '',
        subject: headPart[3] || '',
        status
      })
    }
    return out.filter(c => c.hash)
  } catch {
    return []
  }
}

/** 读 skill 文件内容 + git 时间戳 (不存在返回 null) */
export async function readSkillFile(rel: string): Promise<{ content: string; updatedAt: string | null; lastCommit: string | null } | null> {
  const abs = safeJoin(rel)
  if (!abs || !fs.existsSync(abs)) return null
  const content = fs.readFileSync(abs, 'utf8')
  let updatedAt: string | null = null
  let lastCommit: string | null = null
  try {
    const { stdout } = await execFileAsync('git', ['-C', REPO_DIR, 'log', '-1', '--pretty=format:%h%x1f%ci', '--', `skills/${rel}`])
    const [h, d] = stdout.split('\u001f')
    lastCommit = h || null
    updatedAt = d || null
  } catch { /* 未提交的文件 */ }
  return { content, updatedAt, lastCommit }
}

/** 全部 skill 列表 (聚合 SKILL.md frontmatter) */
export function listSkills(): SkillMeta[] {
  if (!fs.existsSync(SKILLS_DIR)) return []
  const out: SkillMeta[] = []
  for (const e of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const skillMd = path.join(SKILLS_DIR, e.name, 'SKILL.md')
    if (!fs.existsSync(skillMd)) continue
    const raw = fs.readFileSync(skillMd, 'utf8')
    const { meta } = parseFrontmatter(raw)
    out.push({
      name: e.name,
      description: typeof meta.description === 'string' ? meta.description : '',
      globs: Array.isArray(meta.globs) ? meta.globs : [],
      alwaysApply: meta.alwaysApply === true
    })
  }
  return out
}

/** 仓库全部 skills 路径的 git 迭代总时间线 (跨分支, 最近 limit 条) */
export async function globalHistory(limit = 100): Promise<Array<{ hash: string; date: string; author: string; subject: string; files: string[] }>> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', REPO_DIR, 'log', '--name-only', '--pretty=format:%h%x1f%ci%x1f%an%x1f%s%x1e', `-${limit}`, '--', 'skills/']
    )
    const out: Array<{ hash: string; date: string; author: string; subject: string; files: string[] }> = []
    for (const seg of stdout.split('\u001e')) {
      const trimmed = seg.replace(/^\n/, '')
      if (!trimmed.trim()) continue
      const nl = trimmed.indexOf('\n')
      const headPart = (nl === -1 ? trimmed : trimmed.slice(0, nl)).split('\u001f')
      const files = nl === -1 ? [] : trimmed.slice(nl + 1).split('\n').map(s => s.trim()).filter(Boolean).map(s => s.replace(/^skills\//, ''))
      out.push({ hash: headPart[0] || '', date: headPart[1] || '', author: headPart[2] || '', subject: headPart[3] || '', files })
    }
    return out.filter(c => c.hash)
  } catch {
    return []
  }
}

/** git diff 任意两个版本的同一路径 (空 to = 工作区) */
export async function diffVersion(rel: string, from: string, to: string): Promise<string> {
  try {
    const args = ['-C', REPO_DIR, 'diff', '--no-color', from, ...(to ? [to] : []), '--', `skills/${rel}`]
    const { stdout } = await execFileAsync('git', args)
    return stdout
  } catch (e) {
    return `diff 失败: ${(e as Error).message}`
  }
}
