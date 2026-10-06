/**
 * K线对比基准: 把基准指数 (沪深300) 归一化对齐到标的可见窗口
 * 纯函数, 供 KlineChart 绘图与涨跌幅文本共用
 */
export interface BenchBar { date: string; close: number }

/**
 * 基准指数按窗口归一化为百分比序列 (相对窗口首根基准值)
 * 双方按尾部对齐 (最后一个元素视为同一交易日)
 * 基准缺失的位置返回 null
 */
export function alignBenchPct(
  stockBars: BenchBar[],
  benchBars: BenchBar[],
  winStart: number,
  winSize: number
): Array<number | null> {
  const out: Array<number | null> = []
  if (!stockBars.length || !benchBars.length) return out
  const n = stockBars.length
  const size = Math.max(0, Math.min(winSize, n - winStart))
  if (size === 0) return out
  const bBaseIdx = benchBars.length - (n - winStart)
  const base = benchBars[Math.max(0, bBaseIdx)]?.close
  if (!base || !Number.isFinite(base) || base <= 0) return new Array<number | null>(size).fill(null)
  for (let i = 0; i < size; i++) {
    const bi = bBaseIdx + i
    if (bi < 0 || bi >= benchBars.length) { out.push(null); continue }
    const c = benchBars[bi].close
    if (!c || !Number.isFinite(c)) { out.push(null); continue }
    out.push((c - base) / base)
  }
  return out
}

/** 窗口内基准涨跌幅 (%) — 取末个非空点; 无有效点返回 null */
export function benchWindowChange(pcts: Array<number | null>): number | null {
  for (let i = pcts.length - 1; i >= 0; i--) {
    const p = pcts[i]
    if (p != null && Number.isFinite(p)) return p * 100
  }
  return null
}
