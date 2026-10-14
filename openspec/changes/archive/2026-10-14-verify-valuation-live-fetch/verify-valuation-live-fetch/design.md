# Design: 估值数据源切到实拉验证过的东财报表

## Context

上一轮 `fix-valuation-data-fetch` 用 push2 快照 + `RPT_VALUATIONANALYSIS`, 浏览器 16 行全 "—"。本轮对真实 API 逐项 curl 实拉, 确认这两个源本身就是错的, 改为两个**实拉验证成功**的 datacenter-web 报表。

## 实拉验证证据 (2026-08-14, 全部带 CORS 头, 浏览器可直接 fetch)

| 探针 | 结果 |
|---|---|
| push2 `stock/get` fields=f43,f57,f58,f162,f167 `secid=1.000300` | `{"data":{"f43":465988,"f58":"沪深300","f162":0,"f167":0}}` → 指数无 PE/PB |
| `reportName=RPT_VALUATIONANALYSIS` | `{"code":9501,"message":"报表配置不存在,RPT_VALUATIONANALYSIS"}` |
| `reportName=RPT_VALUEMARKET` filter=`(TRADE_MARKET_CODE="000300")` | OK, 2334 条历史 (2017-01-03 至今), `PE_TTM_AVG`, **每页上限 500** |
| `reportName=RPT_VALUEINDUSTRY_DET` filter=`(BOARD_CODE="016029")` | OK, 2334 条历史, `PE_TTM` / `PB_MRQ`, **pageSize=2400 一次拿全** |
| danjuan `index_eva/dj` (6 指数 PE/PB/分位齐全) | HTTP 200 但**无 `Access-Control-Allow-Origin`** → 浏览器读不到 |

### 全量实拉 (模拟新 fetch 逻辑, 16/16 成功)

```
名称       类型   最新日          PE      PB       分位   历史点
上证指数     index 2026-08-13   13.78      —       49   2334
沪深300    index 2026-08-13   36.63      —      100   2334
深证成指     index 2026-08-13   25.24      —       80   2334
创业板指     index 2026-08-13   46.72      —       57   2334
科创50     index 2026-08-13  121.03      —      100   1714
北证50     index 2026-08-13   41.64      —       52   1152
银行Ⅱ      industry 2026-08-13    7.07  0.69       70   2334
化学制药     industry 2026-08-13   68.89  8.70       92   2334
半导体      industry 2026-08-13  145.84 24.03       90   2334
软件开发     industry 2026-08-13   94.68  9.72       34   2334
白酒Ⅱ      industry 2026-08-13   21.84  4.98       16   2334
电池       industry 2026-08-13   37.85  4.71       24   2334
证券Ⅱ      industry 2026-08-13   21.66  1.55        8   2334
游戏Ⅱ      industry 2026-08-13   27.33  5.08        4   2334
通信设备     industry 2026-08-13  111.88 22.41       98   2334
服装家纺     industry 2026-08-13   56.96  3.23       96   2334
```

## 设计

### 数据流 (每标的)

```
fetchOne(symbol)
 ├─ kind='index'   → fetchMarketValuation:   RPT_VALUEMARKET 翻页 (500/页 × ~5) 拿全历史
 └─ kind='industry' → fetchIndustryValuation: RPT_VALUEINDUSTRY_DET 一次拿全 (pageSize=2400)
最新一行 (TRADE_DATE 最大) = 当前值; 其余 = 历史 PE 序列 → computePercentile → bucket
```

- 不再有独立快照请求: 历史序列的第 1 条 (降序) 即当前值。
- 当前值本身在历史内 → 分位最小 1/N (约 1%), 不可能为 0; 与"当前在自身历史中"的通用口径一致。
- `parseEastmoneyValuationHistory(payload, peField, pbField)`:
  - 指数: `peField='PE_TTM_AVG'`, `pbField=null` → pb 恒 null (报表无 PB)
  - 行业: `peField='PE_TTM'`, `pbField='PB_MRQ'`
  - `TRADE_DATE` 兼容 `'YYYY-MM-DD HH:mm:ss'` (真实东财带时间后缀), 归一为日期
  - PE ≤ 0 的行直接跳过 (最新行 PE 异常时回退到最近有效值)

### URL (filter 单次编码, 防 %25)

```ts
new URLSearchParams({
  reportName, columns, pageNumber, pageSize,
  filter: '(BOARD_CODE="016029")',   // 真实字符, URLSearchParams 编码一次
  sortColumns: 'TRADE_DATE', sortTypes: '-1', source: 'WEB', client: 'WEB'
})
```
→ `filter=%28BOARD_CODE%3D%22016029%22%29` (无 `%25`)。

### 标的清单对齐 (BUILTIN_SYMBOLS)

- 6 指数: 000001 上证指数 / 000300 沪深300 / 399001 深证成指 / 399006 创业板指 / 000688 科创50 / 899050 北证50 — RPT_VALUEMARKET 仅覆盖这 6 个市场 (另有 500001 上证基金, 非宽基, 弃用)。
- 10 行业 (申万三级, 每个对应原需求的一级行业): 银行Ⅱ(银行) 化学制药(医药生物) 半导体(电子) 软件开发(计算机) 白酒Ⅱ(食品饮料) 电池(电力设备) 证券Ⅱ(非银金融) 游戏Ⅱ(传媒) 通信设备(通信) 服装家纺(纺织服饰)。
- 中证500/中证1000/上证50 与申万一级粒度无浏览器可用源 → 以替代标的对齐。

### store

`fetchAll` 由串行改 `Promise.all` 并行 (16 个 fetchOne 并发, 指数内部各自翻页)。总请求约 40 次, 峰值并发 ~16, 墙钟 ~2s。进度按完成数更新。

## Risk

- **RPT_VALUEMARKET 的 `PE_TTM_AVG` 是算术平均法**: 与加权 PE 口径不同 (沪深300 显示 36.63 vs 官方加权 ~13)。但**同一口径贯穿全部历史**, 分位是"当前在自身历史上的位置", 内部一致, 仍有意义。绝对 PE 值仅供横向参考。
- 东财报表 / 字段名可能变更 → filter 解析失败走 `history-empty`, 不影响 UI 容错。
- 指数无 PB → 该列对指数显示 "—", 属已知降级。

## Migration

无 schema 变更。覆盖 `src/lib/valuation.ts` fetch 层 + `src/stores/valuation.ts` fetchAll 并行化 + 集成/单元测试 mock 改真实报表 shape。
