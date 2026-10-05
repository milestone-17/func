import { FastifyRequest, FastifyReply } from 'fastify'

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const payload = await req.jwtVerify()
    req.userId = (payload as { sub?: string }).sub
    if (!req.userId) throw new Error('no sub')
  } catch {
    await reply.code(401).send({ error: '未登录或会话已过期' })
  }
}
