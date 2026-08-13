#!/usr/bin/env node
/**
 * 抓取指数近 2 年日线收盘价, 写入 public/index-data.json
 *
 * 标的: ^NDX (纳斯达克100) + ^GSPC (标普500)
 *
 * 为什么需要这个: 浏览器直接拉 Yahoo 会被 CORS 拦截。
 * 本脚本在构建时(服务端/CI, 无 CORS 限制)运行, 把数据打包进站点,
 * App 同源读取 → 永远不会跨域失败。
 *
 * 数据源: Yahoo Finance chart API
 *   https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?range=2y&interval=1d
 *   https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=2y&interval=1d
 *
 * 失败安全: 单个指数失败时保留旧文件中该指数的数据 (合并写入);
 *           全部失败时保留已有文件 (不阻断构建)。
 */
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'public', 'index-data.json')
const INDICES = [
  { yahoo: '%5ENDX', symbol: '^NDX', name: '纳斯达克100指数' },
  { yahoo: '%5EGSPC', symbol: '^GSPC', name: '标普500指数' }
]

function tsToDate(ts) {
  const d = new Date(ts * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function fetchIndex(idx) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${idx.yahoo}?range=2y&interval=1d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (local-finance-fetch)' } })
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${idx.symbol}`)
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result || !result.timestamp) throw new Error(`Yahoo 返回数据结构异常: ${idx.symbol}`)
  const ts = result.timestamp
  const closes = result.indicators?.quote?.[0]?.close || []
  const bars = []
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i]
    if (c == null || Number.isNaN(c)) continue
    bars.push({ date: tsToDate(ts[i]), close: Math.round(c * 100) / 100 })
  }
  if (bars.length < 250) throw new Error(`${idx.symbol} 数据不足: 仅 ${bars.length} 条, 需 ≥250`)
  return { symbol: idx.symbol, name: idx.name, fetchedAt: Date.now(), source: 'yahoo', count: bars.length, bars }
}

async function main() {
  console.log('[fetch-indices] 抓取 NDX + GSPC 近 2 年日线...')
  const indices = {}
  for (const idx of INDICES) {
    try {
      indices[idx.symbol] = await fetchIndex(idx)
      console.log(`[fetch-indices] ✓ ${idx.symbol}: ${indices[idx.symbol].count} 条, ${indices[idx.symbol].bars[0].date} ~ ${indices[idx.symbol].bars[indices[idx.symbol].count - 1].date}`)
    } catch (e) {
      console.warn(`[fetch-indices] ✗ ${idx.symbol} 抓取失败: ${e.message}`)
    }
  }

  // 合并旧文件中仍存在的指数 (单次失败不丢失已有指数)
  const merged = { ...indices }
  try {
    const old = JSON.parse(fs.readFileSync(OUT, 'utf8'))
    if (old?.indices) {
      for (const k of Object.keys(old.indices)) {
        if (!merged[k]) merged[k] = old.indices[k]
      }
    }
  } catch { /* 无旧文件, 忽略 */ }

  if (Object.keys(merged).length === 0) {
    console.warn('[fetch-indices] ✗ 无任何指数数据, 保留已有 index-data.json')
    return
  }

  const out = { generatedAt: Date.now(), indices: merged }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out))
  console.log(`[fetch-indices] ✓ 写入 ${OUT}, 指数: ${Object.keys(merged).join(', ')}`)
}

main().catch((e) => {
  console.warn(`[fetch-indices] ✗ ${e.message}; 保留已有数据文件`)
})
