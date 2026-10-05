import { makeRemoteRepo } from '@/repos/remote-base'
import type { DCAExecution } from '@/types/dca'

const repo = makeRemoteRepo<DCAExecution>('dcaExecutions')

export const dcaExecutionRepo = {
  async add(input: Omit<DCAExecution, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<DCAExecution> {
    return repo.add(input)
  },
  async put(e: DCAExecution): Promise<DCAExecution> {
    return repo.put(e)
  },
  async listByMonth(month: string): Promise<DCAExecution[]> {
    const all = await repo.list({ month })
    return all.sort((a, b) => a.weekIndex - b.weekIndex || a.date.localeCompare(b.date))
  },
  /** 按 configId+month+weekIndex 查重, 用于周度自动执行幂等判定 */
  async findBySlot(configId: string, month: string, weekIndex: number): Promise<DCAExecution | undefined> {
    const all = await repo.list({ configId, month })
    return all.find(e => e.weekIndex === weekIndex)
  },
  async listAll(): Promise<DCAExecution[]> {
    const all = await repo.list()
    return all.sort((a, b) => b.date.localeCompare(a.date))
  }
}
