import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const payload = await req.jwtVerify()
    req.userId = (payload as { sub?: string }).sub
    if (!req.userId) throw new Error('no sub')
  } catch {
    await reply.code(401).send({ error: '未登录或会话已过期' })
    return
  }
  // 禁用用户全局拦截 + 更新活跃时间 (fire-and-forget, 不阻塞请求)
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { disabled: true }
    })
    if (!user || user.disabled) {
      await reply.code(401).send({ error: '账号已被禁用' })
      return
    }
    prisma.user.update({ where: { id: req.userId }, data: { lastSeenAt: new Date() } }).catch(() => {})
  } catch {
    // 数据库瞬时异常不阻塞请求 (认证本身已通过)
  }
}
