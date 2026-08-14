import { openDb } from '@/repos/db'
import type { ValuationSnapshot } from '@/types/valuation'

export const STORE_VALUATION_SNAPSHOTS = 'valuationSnapshots' as const

function todayId(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoId(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export const valuationRepo = {
  /** 写入/覆盖当日快照 */
  async put(snapshot: ValuationSnapshot): Promise<ValuationSnapshot> {
    const db = await openDb()
    await db.put(STORE_VALUATION_SNAPSHOTS, snapshot)
    db.close()
    return snapshot
  },

  /** 按日期 id 取快照 */
  async getByDate(id: string): Promise<ValuationSnapshot | undefined> {
    const db = await openDb()
    const r = await db.get(STORE_VALUATION_SNAPSHOTS, id) as ValuationSnapshot | undefined
    db.close()
    return r
  },

  /** 取最近 limit 条快照 (按 id 字典序倒序, 即日期最新优先) */
  async listRecent(limit = 30): Promise<ValuationSnapshot[]> {
    const db = await openDb()
    const all = await db.getAll(STORE_VALUATION_SNAPSHOTS) as ValuationSnapshot[]
    db.close()
    all.sort((a, b) => b.id.localeCompare(a.id))
    return all.slice(0, limit)
  },

  /** 取最近一次任意时间的快照 (用于拉取失败时的兜底展示) */
  async getLatest(): Promise<ValuationSnapshot | undefined> {
    const list = await this.listRecent(1)
    return list[0]
  },

  /** 取最近 N 天内最新一条; 超过 N 天返回 undefined */
  async getWithinDays(days: number): Promise<ValuationSnapshot | undefined> {
    const list = await this.listRecent(30)
    const cutoff = daysAgoId(days)
    for (const s of list) {
      if (s.id >= cutoff) return s
    }
    return undefined
  },

  /** 内部辅助: 生成今日 id (供 store 调用) */
  _todayId: todayId
}
