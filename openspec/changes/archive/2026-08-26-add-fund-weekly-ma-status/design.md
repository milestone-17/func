# Design: 基金周线状态（20/30/60 周线上·线下）

## Context

持仓页（`src/pages/Portfolio.vue`）已有「拉取全部」现价刷新能力，数据层已验证两条历史行情通路：

- 6 位数字基金：`src/lib/fundQuote.ts` 的 `fetchFundNavTrend(code)` —— 东财 pingzhongdata 脚本标签加载全量日频净值（~281KB/只），通过全局变量 `Data_netWorthTrend` 取数
- 字母代码（美股/ETF）：`src/lib/yahoo.ts` 的代理链 + `parseYahooChart`（Yahoo chart JSON → bars）

`src/lib/ma.ts` 已有经过测试的 `computeMA(closes, period)`（取末值窗口，不足或含空值返回 null）。IndexedDB `meta` store 是现成的 key-value 存储（`metaRepo.get/put`）。

需求见 proposal.md；行为契约见 specs/fund-weekly-ma-status/spec.md。

## Goals / Non-Goals

**Goals:**

- 一键拉取全部有效持仓的 20/30/60 周线状态并在持仓卡片原位展示
- 纯函数周线计算（重采样 / MA / 判定）100% 可单测，不依赖网络
- 结果本地持久化，二次进入页面秒回显，零 DB 迁移

**Non-Goals（设计层面）:**

- 不做 K 线图、不做自动买卖建议、不覆盖 HK（proposal Non-Goals 已列）
- 不做增量更新（每次拉取全量重算；单只 ~300KB × 持仓数在可接受范围）

## Decisions

### D1: 入口放在持仓页，结果做进持仓卡片（而非独立页面）

周线状态是**用户自己持仓**的属性，与市值/涨跌同屏看才有决策价值；Suggest 页模式（独立表格页）适合"行业温度计"这类横向比较场景。新增按钮与现有「拉取全部」并列，徽章行挂在每张卡片数据网格下方，交互路径最短。

*备选*：独立「周线」页 + 表格 —— 信息密度高但脱离持仓上下文，且多一个 Tab 入口；放弃。

### D2: 周线由日频重采样（基金）/ 直接周频（美股），判定基准 = 最新净值

- 基金：pingzhongdata 只有日频 → 按 ISO 自然周分组，取**每周最后一个有效净值**为周收盘
- 美股：Yahoo 直接要 `range=5y&interval=1wk`，返回值即周收盘（`parseYahooChart` 对任意 interval 通用）
- 判定基准：序列最新一个有效值（基金=最新日净值；美股=最新周收盘）。最后一周即使是未走完的 partial week 也计入 MA 窗口 —— 与行情软件实时周线口径一致
- 净值 == MA 记"线上"（spec 已钉死）

ISO 周分组用纯字符串/UTC 计算（`isoWeekKey(dateISO)`），避免本地时区漂移。

### D3: MA 计算复用 `computeMA`，周期常量 `[20, 30, 60]`

`computeMA(weeklyCloses, N)` 语义正好是"末值窗口、不足返回 null"，逐周期调用即得三档结果；历史不足的周期自然为 null → 展示"数据不足"。不新写 MA 逻辑。

### D4: 拉取必须串行（pingzhongdata 全局变量竞态）

`fetchFundNavTrend` 通过 `window.Data_netWorthTrend` 传数，**两只并发加载会互相覆盖**。因此拉取循环串行执行，每完成一只更新 `progress`。副作用是 UX 慢一点（每只 ~1-3s），用进度提示弥补。美股代理链无此约束，但统一串行，保持进度语义简单。

### D5: 独立 Pinia store + metaRepo 快照，不动 DB schema

- `src/stores/weekMa.ts`：`state = { rows: Map<holdingId, WeekMaRow>, loading, progress, fetchedAt }`，actions `fetchAll(holdings)` / `retryOne(holdingId)` / `loadFromCache()`
- 不并入 portfolio store（职责不同，避免已有 500+ 行 store 继续膨胀）
- 快照整体存 `meta` store，key = `week-ma-snapshot`：`{ fetchedAt, rows: Record<holdingId, WeekMaRow> }` —— 一次 `put` 完成持久化，**无 DB 版本迁移**
- 展示时按当前有效持仓过滤 rows：删除的持仓自然不显示，新增持仓无徽章（spec 场景"快照随持仓失效"）

```ts
interface WeekMaPeriodStatus { period: 20 | 30 | 60; ma: number | null; position: 'above' | 'below' | null }
interface WeekMaRow {
  holdingId: string; symbol: string; name: string
  lastValue: number | null      // 判定基准（最新净值/收盘）
  weekCount: number             // 周收盘数量
  statuses: WeekMaPeriodStatus[]
  fetchedAt: number
  error?: string                // 拉取失败（单只）
  unsupported?: boolean         // 代码形态不支持
}
```

### D6: 代码路由与失败容错沿用 `fetchHoldingPrices` 哲学

`weekMa.ts` 导出 `fetchWeekMaRow(holding)`：6 位数字 → `fetchFundNavTrend`；字母 → 新增 `fetchWeeklyBars(symbol)`（yahoo.ts，直连 + 代理链 + `fetchWithTimeout`，≥60 bars 视为有效，不足按 weekCount 走"数据不足"）；其余 → `{ unsupported: true }` 不发请求。单只失败写 `error` 不抛出，其余持仓不受影响。

## Risks / Trade-offs

- [pingzhongdata 单只 ~281KB，持仓多时串行总时长线性增长] → 进度条 + 每只限时（沿用 12s 默认超时）；持仓规模典型 <20 只，可接受
- [Yahoo 公共代理链不稳定，字母代码可能失败] → 该持仓显示失败态可单只重试；失败不污染已有快照其他行
- [未走完的 partial week 计入 MA，周中拉取与周五拉取结论可能不同] → 口径与行情软件一致，属预期行为；快照标注拉取日期
- [meta 快照无 TTL，长期不重拉会显示旧结论] → 徽章区常驻"截至 YYYY-MM-DD"标注，用户自判断新旧

## Migration Plan

纯新增功能，无 DB/路由/API 变更：合并即生效，回滚 = revert 相关提交，旧数据（meta 中无该 key）不受影响。
