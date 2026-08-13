/**
 * 持仓分类自动推断 (按名称/代码关键词)
 *
 * 注意歧义: 中国"中证500"≠"标普500", 故标普规则不匹配裸"500",
 *           仅匹配"标普/S&P/SP500/SPY/SPX"。
 * 顺序敏感, 先匹配先返回。
 */
import type { HoldingCategory } from '@/types/portfolio'

interface Rule { re: RegExp; cat: HoldingCategory }

const RULES: Rule[] = [
  { re: /红利|股息|dividend/i, cat: 'dividend' },
  { re: /标普|s&p|sp500|spy|spx/i, cat: 'sp500' },
  { re: /纳指|纳斯达克|qqq|ndx|nasdaq/i, cat: 'nasdaq100' },
  { re: /债|bond/i, cat: 'bond' },
]

export function inferCategory(name: string, symbol: string): HoldingCategory {
  const s = `${name || ''} ${symbol || ''}`
  for (const r of RULES) {
    if (r.re.test(s)) return r.cat
  }
  return 'other'
}
