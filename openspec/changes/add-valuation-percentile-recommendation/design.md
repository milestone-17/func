# Design: 估值分位建议

## Context

`func/` 是一个 Vue 3 + Vite + TS + IndexedDB 本地优先 PWA，参考 `src/lib/fundQuote.ts` 已验证"JSONP 拉东财 + 失败兜底"的可行性。本次新增"建议（Suggest）"页落地市场温度计——一次性拉取多标的 PE-TTM 序列并算分位，5 档分级，表格排序 + 关键词搜索。已有模式可复用：

- **JSONP 拉数**：`fundQuote.ts` 用 `<script>` 标签注入绕 CORS；本次同模式
- **失败兜底**：`dca` 模块 `stooq.ts` 失败时回退到 IndexedDB 旧值并标"陈旧"
- **DB 演进**：`repos/db.ts` 用 `idb` 的 `upgrade` callback 增量加 store
- **表格 + 搜索**：参考 `pages/Dca.vue` 已有的 search box + 排序头模式

约束：纯前端、零 Token、GitHub Pages 部署、必须支持弱网（无网时显示最近一次本地快照）。

## Goals / Non-Goals

**Goals:**

- 单次拉取内置 ≥ 16 个标的（6 宽基 + 10 行业），单标的串行避免限流，进度可见
- 分位计算用纯函数 + 完整单测（边界：序列长度=1、全相同值、空序列）
- 排序 & 搜索在前端完成，无后端
- 7 天内快照自动加载，> 7 天不自动加载；拉取失败时降级到任意历史快照
- DB 版本从 1 升到 2，向前兼容（v1 数据不丢）

**Non-Goals:**

- 不做实时 PE 推送（每日一次足够）
- 不画 K 线 / 不画历史 PE 带状图（v1 只看分位数）
- 不做行业权重配置（v1 用硬编码列表）
- 不做通知推送

## Decisions

### Decision 1: 数据源选型

**选择**：东方财富数据中心 `push2.eastmoney.com/api/qt/stock/get`（单标的快照）+ `push2his.eastmoney.com/api/qt/stock/kline/get`（K 线含 PE-TTM）

**理由**：

- 与 `fundQuote.ts` 同源，浏览器 JSONP 拉数已在生产验证可用
- 单接口、单标的简单可控；批量用循环串行
- K 线返回字段包含 PE-TTM（`pe_ttm`）→ 直接拿日频序列算分位，免去再算 PE
- 不依赖 AKShare / Tushare 等需要 Token 的源

**备选**：

- 中证指数官网 `csindex.com.cn` 接口 → 部分要 Referer / Cookie，GitHub Pages 跨域不稳
- 申万行业 → 没有公开 API，需爬 HTML
- **结论**：东财是已知最稳的方案，先用，列入下个迭代可考虑多源回退

### Decision 2: 分位算法

**选择**：当前值在历史序列（剔除 null/0/负值）中的百分位 = `count(<= current) / total × 100`，向上取整到整数

**理由**：

- 公式简单、可纯函数化、好测
- 与视频口径一致（视频用历史百分位叙述）
- 边界处理：`n = 0` → null（无数据）；`n = 1` → 50（用 50% 兜底，避免 UI 出现空分位）

**备选**：

- 三次样条插值（中证估值带做法）→ 复杂、收益小
- 高斯核密度 → 过度设计

### Decision 3: 5 档分级映射

**选择**：纯函数 `bucketByPercentile(p: number | null)`，返回 `{ side, label, advice, color }` 联合体，复用 `table.ts` 已有的 `side: 'high' | 'low' | 'flat'` 三态约定

**理由**：

- `< 20%` → side='low'（低估机会）
- `40%–60%` → side='flat'（持有）
- `> 60%` → side='high'（高估风险）
- 与 `DcaSuggestionCard` 配色 (`green` / `blue` / `red`) 一致，UI 风格统一
- 表格行根据 side 上色：green 暖色背景 / red 警示 / blue 中性

**备选**：

- 用枚举 `BUCKET_1..BUCKET_5` → 散到组件里写 if-else 不可控
- **结论**：枚举 + side 映射是干净做法

### Decision 4: 排序 & 搜索的位置

**选择**：在 Pinia store 的 `getter` `displayedRows` 里组合：先 filter（搜索关键词大小写不敏感匹配 name + code），再 sort（mode × direction），最后返回响应式 ref

**理由**：

- 计算放组件会重复；放 store 一次，组件订阅即可
- 搜索与排序"叠加"是 spec 明确要求 → getter 内串联
- 响应式：搜索词/排序模式变化时自动重算，无需手动触发

**备选**：

- 在 `pages/Suggest.vue` 的 `computed` 里写 → 简单但与未来扩展（多列排序、收藏）冲突
- **结论**：Pinia getter 是当前规模下的最优层

### Decision 5: DB Schema

**选择**：新增 store `valuationSnapshots`，主键 `id = 'YYYY-MM-DD'`，value 是 `{ id, takenAt, rows: ValuationRow[] }`

```ts
interface ValuationSnapshot {
  id: string             // 'YYYY-MM-DD'，与 fetchDate 对齐
  takenAt: number        // Date.now()
  source: 'eastmoney' | 'cache'
  rows: ValuationRow[]   // 内置全部标的
}

interface ValuationRow {
  code: string           // 'sh000300'
  name: string           // '沪深300'
  kind: 'index' | 'industry'
  peTtm: number | null
  pb: number | null
  percentile: number | null  // 0-100
  bucket: 'low' | 'flat' | 'high' | null
  fetchedAt: number
  failReason?: string
}
```

**理由**：

- 一天一条快照（避免一天多次拉取堆存储）
- `ValuationRow` 是 denormalized 的，UI 表格直接用
- 失败标 `failReason` 而不是写 `null` 哑数据，UI 区分"暂无数据"和"拉取失败"

**备选**：

- 一天多条（按 fetchAt）→ 当前业务不需要多次，浪费
- 拆分两个 store（snapshots + rows）→ 多一次事务，没必要

### Decision 6: 进度条与失败重试

**选择**：`valuationStore.fetchAll()` 返回 `Promise<{ ok: number; fail: number }>`；过程中维护 `progress: 0..100` ref；UI 用顶部细进度条 + 已完成/总数文字

**单标的串行**：每完成一个 await 后立即 `progress.value = done / total * 100`，避免"全成功才一次性跳"的体验

**重试**：表格行右侧"重试"按钮，仅触发 `fetchOne(code)`，更新对应行；不影响其他行

### Decision 7: 路由与底部 Tab

**选择**：

- 路由 `/suggest`，name `suggest`
- AppShell 底部 Tab 6 项：当前是「首页 / 流水 / 预算 / 持仓 / 定投 / 设置」，插入「建议」到「定投」和「设置」之间：`首页 / 流水 / 预算 / 持仓 / 建议 / 设置`
- 图标：Lucide `lightbulb` 描边风格（与现有图标一致）

**理由**：

- 5 项变 6 项不挤压（grid-cols-6 已经预留了 6 列）
- 放在「持仓」和「设置」之间，从"看资产"自然过渡到"看机会"再到"管配置"

## Risks / Trade-offs

- **[风险] 拉取耗时长**：16 标的 × 串行 × ~1s/个 ≈ 16s → 用进度条 + 失败可重试缓解；后续可考虑 4 路并发但有触发限流风险
- **[风险] DB 升级兼容性**：v1→v2 加 store，IDB `upgrade` callback 内 `version(2).createObjectStore(...)`；v1 数据不丢，但 `idb` 库的 `openDb` 必须严格只升一档 → 已在 `db.ts` 既有代码用此模式
- **[风险] 东财接口字段变更**：`pe_ttm` 字段名未来可能变 → 解析时用 `??` 兜底，缺失即 `null` 行
- **[风险] 排序语义被误读**：「优先级」一词在投资语境既可指"高分位优先"也可指"低分位优先" → 表格上方加文案 "估值低 → 高｜优先买入候选" 和 "估值高 → 低｜优先回避候选" 显式说明
- **[权衡] 选股列表硬编码**：v1 不支持用户自定义标的，迭代 v2 引入 `customSymbols` 配置

## Migration Plan

1. **DB 迁移**：`repos/db.ts` 把 `func-db` 版本从 1 升到 2，`upgrade` callback 内 `if (!db.objectStoreNames.contains('valuationSnapshots')) { db.createObjectStore('valuationSnapshots', { keyPath: 'id' }) }`；v1 store 全部保留
2. **部署**：合并到 `main` → GitHub Actions 自动 build → Pages 部署；用户首次打开会自动触发 IDB 升级（无感）
3. **回滚**：新 store 不影响既有逻辑；如有问题直接 revert PR，所有 v1 数据完好

## Open Questions

无。所有会在设计/任务中影响实现路径的决策（数据源、算法、DB schema、UI 排序语义）均已确定。
