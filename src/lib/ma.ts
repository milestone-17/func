export function computeMA250(closes: (number | null)[]): number | null {
  const window = closes.slice(-250)
  if (window.length < 250) return null
  if (window.some(v => v === null || v === undefined || Number.isNaN(v as number))) return null
  const valid = window as number[]
  const sum = valid.reduce((a, b) => a + b, 0)
  return sum / 250
}

/** 通用移动平均 (取末值); 数据不足 period 或窗口含空值返回 null */
export function computeMA(closes: (number | null)[], period: number): number | null {
  if (period <= 0) return null
  const window = closes.slice(-period)
  if (window.length < period) return null
  if (window.some(v => v === null || v === undefined || Number.isNaN(v as number))) return null
  const valid = window as number[]
  const sum = valid.reduce((a, b) => a + b, 0)
  return sum / period
}

/** 滚动移动平均线: 返回与 closes 等长的序列, 不足 period 处为 null */
export function rollingMA(closes: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  let count = 0
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i]
    if (v != null && !Number.isNaN(v)) { sum += v; count++ }
    if (i >= period) {
      const old = closes[i - period]
      if (old != null && !Number.isNaN(old)) { sum -= old; count-- }
    }
    out.push(count >= period ? sum / period : null)
  }
  return out
}
