import { createHash, randomInt } from 'node:crypto'
import { prisma } from './prisma'

export function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email.toLowerCase()}::${code}`).digest('hex')
}

export function genCode(): string {
  return String(randomInt(0, 1000000)).padStart(6, '0')
}

const PURPOSES = ['register', 'reset'] as const
export type Purpose = (typeof PURPOSES)[number]

export function isPurpose(v: unknown): v is Purpose {
  return typeof v === 'string' && (PURPOSES as readonly string[]).includes(v)
}

export async function verifyCode(email: string, purpose: Purpose, code: string): Promise<boolean> {
  const row = await prisma.emailCode.findFirst({
    where: {
      email: email.toLowerCase(),
      purpose,
      usedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: 'desc' }
  })
  if (!row) return false
  if (hashCode(email, code) !== row.codeHash) return false
  await prisma.emailCode.update({ where: { id: row.id }, data: { usedAt: new Date() } })
  return true
}
