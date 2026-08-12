export type Currency = 'CNY' | 'USD'

export function convertCurrency(
  amountFen: number,
  from: Currency,
  to: Currency,
  usdCnyRate: number
): number {
  if (usdCnyRate <= 0) throw new Error('usdCnyRate must be > 0')
  if (from === to) return amountFen
  if (from === 'USD' && to === 'CNY') return Math.round(amountFen * usdCnyRate)
  if (from === 'CNY' && to === 'USD') return Math.round(amountFen / usdCnyRate)
  throw new Error(`Unsupported currency: ${from} -> ${to}`)
}
