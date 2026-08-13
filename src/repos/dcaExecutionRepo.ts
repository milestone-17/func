import { openDb } from '@/repos/db'
import { newId, makeTimestamps, touchUpdated } from '@/repos/base'
import type { DCAExecution } from '@/types/dca'

export const dcaExecutionRepo = {
  async add(input: Omit<DCAExecution, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<DCAExecution> {
    const db = await openDb()
    const ts = makeTimestamps()
    const e: DCAExecution = { id: newId(), ...input, ...ts }
    await db.add('dcaExecutions', e)
    db.close()
    return e
  },
  async put(e: DCAExecution): Promise<DCAExecution> {
    const db = await openDb()
    const out = touchUpdated(e)
    await db.put('dcaExecutions', out)
    db.close()
    return out
  },
  async listByMonth(month: string): Promise<DCAExecution[]> {
    const db = await openDb()
    const all = await db.getAll('dcaExecutions') as DCAExecution[]
    db.close()
    return all.filter(e => e.month === month && !e.deletedAt)
      .sort((a, b) => a.weekIndex - b.weekIndex || a.date.localeCompare(b.date))
  },
  /** 按 configId+month+weekIndex 查重, 用于周度自动执行幂等判定 */
  async findBySlot(configId: string, month: string, weekIndex: number): Promise<DCAExecution | undefined> {
    const db = await openDb()
    const all = await db.getAll('dcaExecutions') as DCAExecution[]
    db.close()
    return all.find(e => e.configId === configId && e.month === month && e.weekIndex === weekIndex && !e.deletedAt)
  },
  async listAll(): Promise<DCAExecution[]> {
    const db = await openDb()
    const all = await db.getAll('dcaExecutions') as DCAExecution[]
    db.close()
    return all.filter(e => !e.deletedAt).sort((a, b) => b.date.localeCompare(a.date))
  }
}
