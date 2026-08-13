## Context

应用是纯前端 Vue3 + Pinia + IndexedDB(idb) PWA，无后端。行情数据靠「构建时打包 + 运行时拉取（Yahoo/东方财富 + CORS 代理链）」获取。本次变更跨多个模块（持仓、永久组合、定投、存储迁移），涉及数据模型与 schema 变更，故需设计文档。动机见 `proposal.md - Why`，行为契约见 `specs/`。

关键现状：
- `db.ts` 的 `upgrade(db)` **无条件** createObjectStore 全部 store；仅因历史只有 v1、idb 仅在版本提升时跑 upgrade 而未出问题。升 v2 时若不加版本守卫，旧库已存在的 store 会被重复创建而抛 `ConstraintError`。
- `dcaConfigs` 是单例（id='singleton'），单 symbol（硬编码 `^NDX`）；`indexData` 已按 `['symbol','date']` 主键、支持多 symbol。
- 持仓均价/数量由 `holdingTxnRepo.computeAvgCost` 从交易流推算，买入交易天然驱动持仓数量与成本——每日定投「自动买入」可复用该机制。
- 永久组合 `permanent.ts` 已实现按持仓 `type` 聚合 + 目标偏差，本次主要是确认其由自动现价驱动、无需手填。

## Goals / Non-Goals

**Goals:**
- 现价：打开页面自动拉 + 手动按钮 + 手动覆盖，失败绝对保留原数据。
- 持仓分类标签与按类聚合小计。
- 永久组合完全由持仓 + 自动现价驱动，用户只设目标。
- 定投多标的（NDX 补 MA180、新增 SPX），策略一致、数据独立。
- 每日定投打开即记账、幂等、无后台幻觉。
- schema v1→v2 安全迁移，历史数据零丢失。

**Non-Goals:**
- 不做后台/Service Worker 定时执行（浏览器限制，如实呈现断档）。
- 不做每日定投的「漏掉交易日批量补录」（默认仅当日；见 Open Questions）。
- 不切换存储到 localStorage（见决策 D6）；保持 IndexedDB。
- 不接入付费/实时性更强的行情源。

## Decisions

### D1：现价获取——保留并增强现有三源策略
保留「构建时打包（同源必成功）+ 运行时 Yahoo/东方财富 + CORS 代理链」。进入投资页 `onMounted` 自动触发逐只拉取；保留「拉取」按钮；保留现价输入框手动覆盖。拉取失败：**不清空、不覆盖** `currentPrice`，置 `syncError`/Toast 提示。
- *替代方案*：纯手动（约束#2 字面）——已与用户确认否决，会丢失现有基础设施与「打开即刷新」体验。
- *替代方案*：WebSocket 实时推送——纯前端无后端，不可行。

### D2：多标的定投——按 symbol 键化，不破坏旧单例
`indexData` 已支持多 symbol。将 `dcaConfigs` 由「单例 singleton」改为「每 symbol 一条」（`id = symbol`，如 `^NDX` / `^GSPC`）。`dcaConfigRepo.getBySymbol(symbol)` 读取全部后按 `symbol` 字段匹配；**对 NDX 兼容读取旧 `singleton`**（`symbol` 字段为 `NDX` 或 id 为 `singleton` 均视为 NDX），新写入一律用 `id=symbol`。**无需 upgrade 内做破坏性数据迁移**——兼容读取最安全。
- store 形态：`Record<symbol, SymbolState>` 响应式 Map + `activeSymbol`；每个 SymbolState 含 `{config, series, ma120, ma180, ma250, lastClose, deviationPct, bucket, suggestions, dataSource, lastSyncAt, syncError}`。
- MA180：复用现有 `rollingMA(closes, 180)`（`ma.ts` 已是任意周期）；新增 `computeMA(closes, period)` 通用函数或直接 `rollingMA(...).at(-1)`。

### D3：标普500 行情——复用打包 + Yahoo 链
`scripts/fetch-nasdaq.cjs` 扩展为抓 `^NDX` 与 `^GSPC`，写入 `public/index-data.json`（结构改为 `{ indices: { '^NDX': {...}, '^GSPC': {...} } }`，保留旧 `bars` 字段做兼容降级）。`yahoo.ts` 的 `loadBundledQuotes()` 支持按 symbol 取；`fetchLiveQuotes()` 参数化 symbol。SPX 失败时同样回落打包数据。

### D4：每日定投——holdingTxn 买入 + 配置幂等
新增 `DailyDcaConfig`（单例 id='daily'）：`{enabled, holdingId, dailyAmountFen, lastExecutedDate(ISO)}`。新增 `src/lib/dailyDca.ts`：
- `shouldExecuteToday(cfg, todayISO)`：`enabled && holdingId 有效 && dailyAmountFen>0 && lastExecutedDate !== todayISO`。
- `execute(cfg, holding)`：若 `holding.currentPrice` 无效→返回 `{ok:false, reason:'no-price'}`（**不记账、提示先填价**）；否则写入一笔 `holdingTxn`（side=buy, date=today, price=currentPriceFen, quantity=dailyAmountFen/price, fee=0, note='每日定投自动'），并将 `lastExecutedDate=today`。
- 触发点：`App.vue` mount 调 `dailyDcaStore.runIfPending()`（一次打开执行一次）；成功后 `portfolio.refresh()`，总额/数量自动更新。
- 幂等：以 `lastExecutedDate===today` 判定，重复打开跳过。
- *替代方案*：补录漏掉的天数——默认不做（见 Open Questions）。

### D5：分类标签与资产类型——两个正交维度
- `Holding` 增字段 `category: 'nasdaq100'|'sp500'|'bond'|'dividend'|'other'`（默认 `'other'`）。IndexedDB 值无 schema，**加字段无需 upgrade**；Portfolio 按 `category` 内存过滤即可（个人数据量小，**无需建索引**，避免无谓 schema 变更）。
- 永久组合仍按 `type`（stock/bond/cash/gold）聚合；`category` 与 `type` 正交（如「纳斯达克100 ETF」= category `nasdaq100` + type `stock`）。新建表单同时提供两者，并给合理默认（选「债券」分类时 type 默认 `bond`，选「红利」分类时 type 默认 `stock`）。

### D6：存储保持 IndexedDB（不切 localStorage）
约束#2 字面写 localStorage，但全应用建于 IndexedDB；localStorage 有 5MB 上限且为同步 API，不适合持仓/交易/行情序列。IndexedDB 已天然持久（刷新/重开不丢）。本次重点是 **schema 升级安全**与**幂等**，而非更换存储。此偏离在 proposal 已注明。

### D7：schema v1→v2 安全升级（核心）
`SCHEMA_VERSION: 1→2`，`upgrade(db, oldVersion)` 改为版本分支：
```
upgrade(db, oldVersion) {
  if (oldVersion < 1) { /* 现有全部 store 创建代码原样移入 */ }
  if (oldVersion < 2) {
    if (!db.objectStoreNames.contains('dailyDcaConfigs'))
      db.createObjectStore('dailyDcaConfigs', { keyPath: 'id' })
  }
}
```
- 旧用户(oldVersion=1)：跳过 v1 块（不重复创建→不抛 ConstraintError），仅建新 store。
- 新用户(oldVersion=0)：两块顺序执行。
- `dcaConfigs`/`holdings` 等已有 store 与数据**完全不动**。
- 唯一新增 store：`dailyDcaConfigs`。无破坏性数据迁移（D2 兼容读取旧 singleton）。

## Risks / Trade-offs

- [行情拉取在浏览器常因 CORS/代理失效] → 回落构建时打包数据（同源必成功）；失败保留原值 + 明确提示，绝不清空。
- [每日定投在浏览器关闭日不执行，用户误以为每日必投] → UI 如实显示「最近执行日期」与「本应执行而未执行」提示，不伪装后台执行。
- [schema 升级中断风险] → upgrade 仅做「新增 store」非破坏操作；失败时 idb 不提交，旧库保持 v1 可用；应用层对 v1/v2 数据均兼容读取。
- [旧 dcaConfigs singleton 兼容] → getBySymbol 双路径匹配，读不到不报错、按未配置处理。
- [分类无索引，数据量大时过滤慢] → 个人记账数据量级（百条内）内存过滤无性能问题；如未来需要再加索引（非本次）。

## Migration Plan

1. 先合并不涉及存储的纯前端改动（分类 UI、MA180、SPX 定投页、每日定投逻辑）。
2. 升 `SCHEMA_VERSION` 到 2 并改写 `upgrade` 为版本分支（D7）。
3. 旧用户刷新后自动 1→2 升级；新用户直接建 v2。
4. 回滚：若 v2 出问题，因未删/改任何 v1 store，回退代码到 v1 即可读全部旧数据（向前兼容）。

## Open Questions

- **每日定投漏天补录**：默认仅记「当日」。是否提供「打开时补录自上次执行以来的每个交易日（封顶 N 天）」可选开关？属体验增强，不改变 spec 核心契约，可在实现后据用户反馈再加。
- **每日定投历史日志**：当前以 `holdingTxn(buy, note='每日定投自动')` 为记录。是否另建 `dailyDcaExecutions` store 做更丰富统计？非必需，可后续。
