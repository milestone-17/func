/**
 * 行情数据 repo (远程版)
 * - 读: 服务端 /api/market (全站共享, cron 定时抓取), 前端内存缓存 5 分钟
 * - 写: 生产 no-op (服务端 cron 是唯一写入方)
 *       测试环境 (mem-api 安装时) 写入内存 indexData 表, 供种数据
 */
import type { IndexData } from '@/types/dca'

interface CacheEntry {
  fetchedAt: number
  bySymbol: Map<string, IndexData[]>
}

const TTL = 5 * 60 * 1000
let cache: CacheEntry | null = null

interface MarketBar { date: string; close: number }
interface MarketIndexEntry { bars: MarketBar[]; latest?: { name?: string } }
interface MarketResp { indices: Record<string, MarketIndexEntry> }

function memDb(): any | null {
  const g = globalThis as any
  return g.__funcMemDb || null
}

function barsToIndexData(symbol: string, bars: MarketBar[]): IndexData[] {
  return bars.map(b => ({ symbol, date: b.date, close: b.close, source: 'server' })) as unknown as IndexData[]
}

async function loadAll(): Promise<CacheEntry> {
  if (cache && Date.now() - cache.fetchedAt < TTL) return cache
  const res = await fetch('/api/market/index-data', { credentials: 'include' })
  if (!res.ok) throw new Error(`行情接口失败 (${res.status})`)
  const data = (await res.json()) as MarketResp
  const bySymbol = new Map<string, IndexData[]>()
  for (const [symbol, entry] of Object.entries(data.indices || {})) {
    bySymbol.set(symbol, barsToIndexData(symbol, entry.bars || []))
  }
  cache = { fetchedAt: Date.now(), bySymbol }
  return cache
}

/** 写入内存表 (仅测试环境有效) */
function memPut(data: IndexData): void {
  const db = memDb()
  if (!db) return
  if (!db.tables.has('indexData')) db.tables.set('indexData', new Map())
  const t = db.tables.get('indexData') as Map<string, IndexData>
  t.set(`${data.symbol}::${data.date}`, data)
  cache = null // 失效缓存
}

export const indexDataRepo = {
  /** 生产 no-op; 测试环境写入内存表供种数据 */
  async put(data: IndexData): Promise<IndexData> {
    memPut(data)
    return data
  },
  /** 按 symbol 取全部行, 升序 (测试环境优先读内存表) */
  async listBySymbol(symbol: string): Promise<IndexData[]> {
    const db = memDb()
    if (db) {
      const t = db.tables.get('indexData') as Map<string, IndexData> | undefined
      if (t) {
        return [...t.values()]
          .filter(d => d.symbol === symbol)
          .sort((a, b) => a.date.localeCompare(b.date))
      }
    }
    try {
      const c = await loadAll()
      return c.bySymbol.get(symbol) || c.bySymbol.get(symbol.replace(/^\^/, '')) || []
    } catch {
      return []
    }
  },
  /** 最新一行 (当前行情快照) */
  async get(symbol: string): Promise<IndexData | undefined> {
    const list = await this.listBySymbol(symbol)
    return list[list.length - 1]
  },
  async list(): Promise<IndexData[]> {
    const db = memDb()
    if (db) {
      const t = db.tables.get('indexData') as Map<string, IndexData> | undefined
      if (t) return [...t.values()]
    }
    try {
      const c = await loadAll()
      return [...c.bySymbol.values()].flat()
    } catch {
      return []
    }
  },
  /** 测试/强制刷新用 */
  _clearCache(): void {
    cache = null
  }
}
