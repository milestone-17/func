export function computeDeviation(close: number, ma: number): number {
  if (ma === 0) return close === 0 ? 0 : Infinity
  return ((close - ma) / ma) * 100
}
