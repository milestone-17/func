import { openDb } from '@/repos/db'
import type { IndexData } from '@/types/dca'

export const indexDataRepo = {
  /** 写入单日行 (主键 ['symbol','date']) */
  async put(data: IndexData): Promise<IndexData> {
    const db = await openDb()
    await db.put('indexData', data)
    db.close()
    return data
  },
  /** 按 symbol 取全部行, 升序 */
  async listBySymbol(symbol: string): Promise<IndexData[]> {
    const db = await openDb()
    const all = await db.getAllFromIndex('indexData', 'by-symbol', symbol) as IndexData[]
    db.close()
    return all.sort((a, b) => a.date.localeCompare(b.date))
  },
  /** 最新一行 (当前行情快照) */
  async get(symbol: string): Promise<IndexData | undefined> {
    const list = await this.listBySymbol(symbol)
    return list[list.length - 1]
  },
  async list(): Promise<IndexData[]> {
    const db = await openDb()
    const all = await db.getAll('indexData') as IndexData[]
    db.close()
    return all
  }
}
