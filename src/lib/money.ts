/**
 * 金额工具 (整数 "分" 单位, 避免浮点)
 *
 * 关键问题: 1.005 在 IEEE 754 里存为 1.00499999999999989
 *   - (1.005 * 100) = 100.49999..., Math.round = 100 ❌ (应该 101)
 *   - (1.005).toFixed(2) 在 V8 也返回 "1.00" ❌ (因为 1.005 实际是 1.00499...)
 *
 * 解决: 字符串解析. V8 中 Number.toString() 返回最短可往返表示:
 *   - (1.005).toString() = "1.005" ✓
 *   - 解析 "1.005" → 整数 1, 小数 005 → 取前 2 位 "00" + 第 3 位 "5" 触发进位 → "01"
 *   - 结果 1*100 + 1 = 101 ✓
 */

export function yuanToFen(yuan: number): number {
  return yuanToCentsInternal(yuan)
}

export function fenToYuan(fen: number): number {
  return fen / 100
}

export function roundYuanToFen(yuan: number): number {
  return yuanToCentsInternal(yuan) / 100
}

export function formatYuan(fen: number): string {
  const yuan = fen / 100
  return yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function yuanToCentsInternal(yuan: number): number {
  if (!isFinite(yuan)) return 0
  const sign = yuan < 0 ? -1 : 1
  const s = Math.abs(yuan).toString()
  const dot = s.indexOf('.')
  let intStr: string
  let decStr: string
  if (dot === -1) {
    intStr = s || '0'
    decStr = ''
  } else {
    intStr = s.slice(0, dot) || '0'
    decStr = s.slice(dot + 1)
  }
  const c1 = decStr.charAt(0) || '0'
  const c2 = decStr.charAt(1) || '0'
  const c3 = decStr.charAt(2) || '0'
  const carry = Number(c3) >= 5 ? 1 : 0
  let cents = Number(c1) * 10 + Number(c2) + carry
  let extra = 0
  if (cents >= 100) {
    cents -= 100
    extra = 1
  }
  return sign * (Number(intStr) * 100 + cents + extra * 100)
}
