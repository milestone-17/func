#!/usr/bin/env node
/**
 * 抓取纳斯达克100官方指数 (NDX) 近 2 年日线收盘价, 写入 public/nasdaq-data.json
 *
 * 为什么需要这个: 浏览器直接拉 Yahoo 会被 CORS 拦截。
 * 本脚本在构建时(服务端/CI, 无 CORS 限制)运行, 把数据打包进站点,
 * App 同源读取 → 永远不会跨域失败。
 *
 * 数据源: Yahoo Finance chart API (^NDX = NASDAQ-100 官方指数)
 *   https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?range=2y&interval=1d
 *
 * 失败安全: 抓取失败时保留已有文件 (不阻断构建)。
 */
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'public', 'nasdaq-data.json')
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?range=2y&interval=1d'

function tsToDate(ts) {
  const d = new Date(ts * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function main() {
  console.log('[fetch-nasdaq] 抓取 NDX (纳斯达克100指数) 近 2 年日线...')
  const res = await fetch(YAHOO, {
    headers: { 'User-Agent': 'Mozilla/5.0 (local-finance-fetch)' }
  })
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`)
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result || !result.timestamp) throw new Error('Yahoo 返回数据结构异常')

  const ts = result.timestamp
  const closes = result.indicators?.quote?.[0]?.close || []
  const bars = []
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i]
    if (c == null || Number.isNaN(c)) continue
    bars.push({ date: tsToDate(ts[i]), close: Math.round(c * 100) / 100 })
  }
  if (bars.length < 250) throw new Error(`数据不足: 仅 ${bars.length} 条, 需 ≥250`)

  const out = {
    symbol: 'NDX',
    name: '纳斯达克100指数',
    fetchedAt: Date.now(),
    source: 'yahoo',
    count: bars.length,
    bars
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out))
  console.log(`[fetch-nasdaq] ✓ 写入 ${OUT}: ${bars.length} 条, ${bars[0].date} ~ ${bars[bars.length - 1].date}`)
}

main().catch((e) => {
  console.warn(`[fetch-nasdaq] ✗ 抓取失败: ${e.message}; 保留已有数据文件`)
})
