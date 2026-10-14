# Design: 行业覆盖扩到全部 127 个申万三级

## Context

用户反馈估值温度计"指数和行业太少了"。上一轮已把数据源切到实拉验证的东财报表(指数 `RPT_VALUEMARKET`、行业 `RPT_VALUEINDUSTRY_DET`),16 行全部成功。本轮把行业从 10 个扩到全部 127 个。**指数保持 6 个不变**——已实测穷尽纯浏览器可 fetch 的源,详见 proposal.md。

## 实测验证 (2026-08-14, 全部对真实 API 实拉)

| 探针 | 结果 |
|---|---|
| `RPT_VALUEINDUSTRY_DET` filter=`(TRADE_DATE='2026-08-13')` | 一次返回 **127 个行业** (BOARD_CODE + BOARD_NAME) |
| 127 个行业逐行业全历史 (pageSize=2400) 并行 | **127/127 成功**, 每行业 2334 个交易日点 (2017 至今) |
| 请求参数对比 (单请求) | `columns=TRADE_DATE,PE_TTM,PB_MRQ` 196KB/1.8s；`columns=ALL` 1205KB/2.7s → **只取 3 列** |
| Python urllib 模拟 127 行业拉取墙钟 (并发 6/20) | ~38s (客户端并发对墙钟影响小, 受服务器吞吐影响) |
| **实际 TS 代码冒烟 (enumerateIndustrySymbols + fetchOne, 真实东财)** | **133/133 全部成功, 墙钟 11.2s** ← 以浏览器/Node fetch 为准 |
| 现有 16 标的首拉基线 (本次实测) | **9.8s** (此前 design 里"~2s"是未实测估算, 有误) |
| 备选: 60 个"月度日期快照" (每请求全部行业某天) | 11.5s, 但每月 13 号仅 43/60 有数据, 且是月度采样分位 |

## Goals / Non-Goals

- **Goals**: 行业覆盖 10 → 127 全量; 首拉体验可接受 (渐进填充 + 缓存); 行业列表不再手工硬编码, 自动跟随东财; 分位口径与指数一致 (日频)。
- **Non-Goals**: 扩指数 (纯浏览器无源, 需后端代理, 已排除); 用月度采样换首拉速度 (分位精度损失, 备选记录不改); 改排序/搜索/分级逻辑。

## 设计

### 1. 标的清单: 指数硬编码 + 行业动态枚举

```ts
// src/lib/valuation.ts
export const BUILTIN_INDICES: ValuationSymbol[] = [ /* 6 指数, 现 BUILTIN_SYMBOLS 中 6 个指数原样保留 */ ]

export async function enumerateIndustrySymbols(anchorDate?: string): Promise<ValuationSymbol[]> {
  // 1. 发现最新交易日: 优先用调用方传入; 否则在同一报表上发
  //    filter=(TRADE_DATE<='今天') pageSize=1 取最新一行 (实测 1 请求, 返回最新交易日)。
  // 2. 快照查询: RPT_VALUEINDUSTRY_DET filter=(TRADE_DATE='<date>') columns=BOARD_CODE,BOARD_NAME,PE_TTM,PB_MRQ
  //    一次拿全 127 行 → [{ code: BOARD_CODE, symbol: BOARD_CODE, name: BOARD_NAME, kind: 'industry' }]
  // 3. 解析失败/空 → throw ('enum-fail: ...', 由 store 兜底走缓存列表)
}
```

- 复用现有 `ValuationSymbol` 类型, 行业行 `symbol` 直接取 `BOARD_CODE` (与现状一致, retryOne 用 code 匹配)。
- 快照查询同时可取回当日 PE/PB, 但**不使用**它做当前值——当前值仍取各行业历史序列第 1 条, 保证与历史同源同口径 (现状逻辑)。

### 2. store: 枚举 + 渐进填充 + 缓存兜底

```ts
// src/stores/valuation.ts fetchAll 改造
async function fetchAll() {
  // A. 组装符号列表: 6 指数 + 127 行业
  let symbols = [...BUILTIN_INDICES]
  let industrySymbols: ValuationSymbol[] | null = null
  try {
    // anchorDate: 若本地 7 天内快照存在, 用其最新 TRADE_DATE 可省一次发现请求
    industrySymbols = await enumerateIndustrySymbols(anchorDate)
    symbols.push(...industrySymbols)
  } catch {
    // 枚举失败 → 用 7 天内快照里缓存的行业行反推 symbol 列表; 无缓存则仅指数
    industrySymbols = cachedIndustrySymbols() ?? []
    symbols.push(...industrySymbols)
  }
  // B. 占位行 (全部 133 行先出现骨架)
  // C. 并行拉取, 每个 resolve 即就地更新该行 (渐进填充):
  results = await Promise.all(symbols.map(async (sym, i) => {
    const row = await fetchOne(sym)
    progress.value = ...
    rows.value[i] = row          // ← 现状是最后统一 rows.value = results
    return row
  }))
  // D. 写当日快照 (含行业列表反推所需: 行业行 code/name 已含在 rows 中)
  // E. 全失败 → staleFallback (现状逻辑不变)
}
```

- **渐进填充**: 把 `rows.value = results` (最后统一赋值) 改为 `rows.value[i] = row` (每行就位)。Vue 响应式对数组下标赋值在 Vue 3 Proxy 下是响应的, 无需 `$set`。
- **retryOne**: 现状按 `BUILTIN_SYMBOLS.find(s => s.symbol === code)` 找符号。改造后 store 保存最近一次 `industrySymbols` 供 retry 匹配; 若行业不在当前列表 (东财移除), retry 直接 no-op。

### 3. 快照与缓存 (复用现状, 无需 schema 变更)

- `valuationRepo` 现有 7 天快照机制不动。快照 `rows` 已含全部 133 行的 code/name/分位, `loadFromCache` 无需重枚举。
- 枚举的行业列表不单独落库: 需要时 (枚举失败兜底) 从最近快照的 `rows` 里反推 `kind='industry'` 行的 code/name。

### 4. 性能取舍 (已实测, 如实记录)

- **首拉 ~11s (实际代码冒烟实测)**: 用真实 `enumerateIndustrySymbols` + `fetchOne` 对真实东财拉 133 标的, 133/133 成功, 墙钟 11.2s。此为准。(早期 Python urllib 基准 ~38s 是受脚本网络栈限制的偏保守估计, 不采用。)
- **缓解**: ① 渐进填充使首行 ~2s 出现, 表格边拉边涨; ② 7 天 IDB 快照, 周期内重开秒开; ③ 只取 3 列, 单请求 196KB 而非 1.2MB。
- **备选 (不采用)**: 60 个月度日期快照 (~11.5s, 每行业 ~43-60 点, 月度分位)。精度与指数日频口径不一致, 弃; 记录于此供未来若首拉不可接受时切换。
- 浏览器 HTTP/2 对同一 host 多路复用, 127 并发 fetch 可同时发出; 冒烟实测无 429, 每行失败可单独重试兜底。

## Risk

- **东财行业快照/字段变更** → 枚举失败走缓存兜底; 个别行业历史空 → 该行"获取失败"可重试, 不阻塞其余。
- **首拉 38s 用户等待** → 渐进填充 + 进度条 + 7 天缓存; 若仍不可接受, 切换到月度快照方案 (design 已记录数据)。
- **133 行 UI 渲染** → 现有表格 + 搜索/排序对 133 行无压力; 不引入虚拟滚动 (超出本轮范围, 必要时后续加)。
- **127 并发请求对东财的压力** → 仅用户主动点击拉取时发生, 每 7 天最多一次; 失败行可重试。

## Migration

无 schema 变更。覆盖 `src/lib/valuation.ts` (拆分 BUILTIN_SYMBOLS + 新增枚举)、`src/stores/valuation.ts` (渐进填充 + 缓存兜底)、测试 mock 扩展 (枚举 + 127 行业渐进填充)。
