export function computeMA250(closes: (number | null)[]): number | null {
  const window = closes.slice(-250)
  if (window.length < 250) return null
  if (window.some(v => v === null || v === undefined || Number.isNaN(v as number))) return null
  const valid = window as number[]
  const sum = valid.reduce((a, b) => a + b, 0)
  return sum / 250
}
