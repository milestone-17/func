/**
 * Skill 知识库 API (管理后台)
 *
 * GET  /api/admin/panel/skills                    skill 列表
 * GET  /api/admin/panel/skills/files              全部文档文件列表
 * GET  /api/admin/panel/skills/file?path=...      文档内容 (渲染用)
 * GET  /api/admin/panel/skills/history            全局迭代时间线
 * GET  /api/admin/panel/skills/history?path=...   单文件迭代历史
 * GET  /api/admin/panel/skills/validate        防腐巡检 (结构/索引/锚点/死链)
 * GET  /api/admin/panel/skills/diff?path=&from=&to=  两版本 diff (to 为空 = 工作区)
 */
import { FastifyInstance } from 'fastify'
import { listSkills, listSkillFiles, readSkillFile, fileHistory, globalHistory, diffVersion, parseSkillMeta } from '../lib/skill-repo'
import { validateSkills } from '../lib/skill-validate'
import { requirePanel } from './admin'

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/panel/skills', { preHandler: requirePanel }, async () => {
    return { items: listSkills() }
  })

  app.get('/api/admin/panel/skills/files', { preHandler: requirePanel }, async () => {
    const files = listSkillFiles()
    const withMeta = await Promise.all(files.map(async rel => {
      const meta = await readSkillFile(rel)
      return { relPath: rel, updatedAt: meta?.updatedAt ?? null, lastCommit: meta?.lastCommit ?? null }
    }))
    return { items: withMeta }
  })

  app.get('/api/admin/panel/skills/history', { preHandler: requirePanel }, async (req) => {
    const { path: rel } = req.query as { path?: string }
    if (rel) return { items: await fileHistory(rel) }
    return { items: await globalHistory() }
  })

  app.get('/api/admin/panel/skills/file', { preHandler: requirePanel }, async (req, reply) => {
    const { path: rel } = req.query as { path?: string }
    if (!rel) return reply.code(400).send({ error: '缺少 path' })
    const file = await readSkillFile(rel)
    if (!file) return reply.code(404).send({ error: '文档不存在' })
    return file
  })

  app.get('/api/admin/panel/skills/diff', { preHandler: requirePanel }, async (req, reply) => {
    const { path: rel, from, to } = req.query as { path?: string; from?: string; to?: string }
    if (!rel || !from) return reply.code(400).send({ error: '缺少 path 或 from' })
    return { diff: await diffVersion(rel, from, to || '') }
  })

  app.get('/api/admin/panel/skills/validate', { preHandler: requirePanel }, async () => {
    return validateSkills()
  })

  app.get('/api/admin/panel/skills/meta', { preHandler: requirePanel }, async () => {
    const parsed = parseSkillMeta()
    const fm = async (p: string) => {
      const f = await readSkillFile(p)
      return { updatedAt: f?.updatedAt ?? null, lastCommit: f?.lastCommit ?? null }
    }
    return {
      ...parsed,
      files: {
        constraints: await fm('_meta/constraints.md'),
        glossary: await fm('_meta/glossary.md'),
        pitfalls: await fm('_meta/pitfalls.md')
      }
    }
  })
}
