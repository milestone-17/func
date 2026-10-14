import { prisma } from './prisma'
import type { SourceId } from './market-fetcher'

const KEY = 'market_source_priority'
const VALID = ['tencent', 'eastmoney', 'yahoo', 'xueqiu']

/** 读取持久化的源优先级, 无记录或内容非法返回 null */
export async function loadPriorityFromDb(): Promise<string[] | null> {
  const row = await prisma.appConfig.findUnique({ where: { key: KEY } })
  if (!row) return null
  const v = row.value
  if (!Array.isArray(v) || v.length !== VALID.length || !v.every((x) => VALID.includes(x as string))) return null
  return v as string[]
}

/** 持久化源优先级 (全排列, 调用方保证) */
export async function savePriorityToDb(priority: SourceId[]): Promise<void> {
  await prisma.appConfig.upsert({
    where: { key: KEY },
    create: { key: KEY, value: priority },
    update: { value: priority }
  })
}
