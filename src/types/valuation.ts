import type { ISODate, Timestamp } from './common'

/** 估值标的的类别: 宽基指数 / 申万行业 */
export type SymbolKind = 'index' | 'industry'

/** 5 档分级的 side (与 dca 的 BucketResult 保持一致命名) */
export type BucketSide = 'low' | 'flat' | 'high'

/** UI tone: green=低估机会, blue=中性, red=高估风险 */
export type BucketTone = 'green' | 'blue' | 'red'

/** 排序模式 */
export type SortMode = 'priority' | 'selection'

/** 内置标的元数据 */
export interface ValuationSymbol {
  code: string         // 东财 secid, 形如 '1.000300' (上证 1., 深证 0.)
  symbol: string       // 短码, 形如 'sh000300'
  name: string         // 中文名
  kind: SymbolKind
}

/** 单标的估值行 (表格的一行) */
export interface ValuationRow {
  code: string         // 与 ValuationSymbol.symbol 对齐
  name: string
  kind: SymbolKind
  peTtm: number | null
  pb: number | null
  percentile: number | null   // 0-100 整数, null = 暂无
  bucket: BucketSide | null   // null = 暂无
  bucketLabel: string | null  // 例: '极度低估'
  bucketAdvice: string | null // 例: '黄金坑'
  bucketTone: BucketTone | null
  fetchedAt: Timestamp
  failReason?: string
}

/** 某日全部标的的快照, 主键 id = 'YYYY-MM-DD' */
export interface ValuationSnapshot {
  id: ISODate
  takenAt: Timestamp
  source: 'eastmoney'
  rows: ValuationRow[]
}
