# Change: 估值分位建议（市场温度计）

## Why

当前 `func/` 项目已能跟踪用户持仓和基金净值，但用户缺少一个**横向比较**入口：在做"现在该不该买/减仓"的判断时，需要一眼看到**各行业、各指数**当前的 PE/PB 估值在历史区间中的分位位置，从而决定"该选谁、该避谁"。

参考视频《建立你的市场温度计：估值百分位（PE/PB Band）》给出 5 档分级：

| 分位区间 | 含义 | 建议动作 |
|---|---|---|
| < 20%  | 极度低估 | 黄金坑 |
| 20% – 40% | 低估区域 | 分批建仓 |
| 40% – 60% | 合理估值 | 持有观望 |
| 60% – 80% | 偏高估值 | 逐步减仓 |
| > 80%  | 极度高估 | 坚决远离 |

本变更新增"**建议（Suggest）**"页，落地这套温度计：点击拉取 → 列表展示 → 排序 & 搜索 → 选型入库。

## What Changes

- 新增 `Suggest` 路由 `/suggest` 与底部 Tab 第 6 项「建议」
- 新增 `valuationRepo`（IndexedDB 新 store `valuationSnapshots`）持久化历史快照
- 新增 `valuation.ts` lib：
  - 数据源：东财行业/指数 PE/PB 估值接口（JSONP 绕 CORS，沿用 `fundQuote.ts` 同样的失败兜底策略）
  - 计算分位：拉取近 N 年日频 PE-TTM 序列 → 当前值在历史序列中的百分位
  - 5 档分级函数 `bucketByPercentile(p)` 返回 `{ side, label, advice }`
- 新增 `SuggestionTable.vue` 组件：表格 + 排序（默认分位升序 = "从低到高" 找机会；切到"选型"模式 = 分位降序 = "从高到低" 避坑）+ 关键词搜索
- 新增 Pinia store `valuationStore` 协调拉取/缓存/状态
- AppShell 底部 Tab 增加「建议」入口（图标：lightbulb）
- 不修改既有 spec（不破 API、不动定投/持仓/预算/永久组合逻辑）

## Capabilities

### New Capabilities

- `valuation-percentile-recommendation`: 行业 / 指数 PE/PB 估值分位拉取、5 档分级、表格排序、关键词搜索、选型入库

### Modified Capabilities

（无。本变更为纯新增，未修改任何既有 spec 的需求。）

## Impact

- **新增文件**：
  - `src/pages/Suggest.vue`
  - `src/components/SuggestionTable.vue`
  - `src/lib/valuation.ts`
  - `src/repos/valuationRepo.ts`
  - `src/stores/valuation.ts`
  - `src/types/valuation.ts`
  - `src/lib/__tests__/valuation.test.ts`
  - `docs/superpowers/specs/2026-08-14-valuation-percentile-recommendation.md`（如需详细设计可后续补）
- **修改文件**：
  - `src/router/index.ts`（新增路由）
  - `src/components/AppShell.vue`（底部 Tab 第 6 项）
  - `src/repos/db.ts`（新增 `valuationSnapshots` store，DB 版本 +1）
- **依赖**：无新增 npm 依赖（复用 `chart.js` / `vue` / `idb`）
- **数据源**：东财 `datacenter.eastmoney.com` 行业/指数估值接口（JSONP，参考 `fundQuote.ts` 已验证可行）
- **离线能力**：拉取结果写入 IndexedDB，弱网时使用最近一次快照并标"陈旧"
- **不影响**：流水 / 预算 / 持仓 / 永久组合 / 智能定投

## Non-Goals

- 不做实时报价（PE/PB 是日频，一次拉取即当日有效）
- 不做行业指数的 K 线图表（v1 只做分位表）
- 不接入 AKShare / Tushare 等付费/Token 源（保持零 Token 部署）
- 不做通知推送（用户手动打开"建议"页）
- 不修改既有定投档位表（`table.ts`）和永久组合（`permanent.ts`）逻辑
- v1 仅覆盖国内 A 股常见行业 + 6 大宽基指数（详见 spec）

## Risk

- **CORS / 接口稳定性**：东财数据中心接口走 JSONP 兜底，与 `fundQuote.ts` 同样策略；失败/超时时静默回退到 IndexedDB 最近快照
- **历史数据量大**：行业指数近 10 年 PE-TTM 日频 ≈ 2400 条 × 30 个标的 ≈ 72k 行；首拉取可能慢 → 进度条 + 单标的串行拉取避免限流
- **行业 / 指数列表维护**：行业分类随东财调整会变 → 列表内置常量 + 拉取失败时降级为内置默认 6 宽基 + 10 行业
- **排序语义歧义**：用户说"优先级从低到高"指分位升序（数值小 = 估值低 = 机会）"选型从高到低"指分位降序（数值大 = 估值高 = 风险）→ spec 明确定义，文案写"估值低→高"避免误解
- **DB 迁移**：新增 store 需要 DB 版本从 1 升到 2 → `openDb` 加 upgrade callback，沿用 v1 数据不丢
