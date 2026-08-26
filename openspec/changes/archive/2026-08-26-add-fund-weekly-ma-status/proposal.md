# Change: 基金周线状态（20/30/60 周线上·线下）

## Why

持仓页已能拉取各基金**现价**，但用户在做加仓/减仓决策时还缺一个经典的趋势参照：**当前净值处于 20 周 / 30 周 / 60 周移动平均线之上还是之下**（"线下蓄势、线上持有"的周线级别判断）。目前需要一只只去行情软件查，缺少"点一个按钮、全部持仓一目了然"的入口。

## What Changes

- 持仓页（Portfolio）顶部新增「周线状态」按钮：点击后**逐只拉取**全部有效持仓的净值/收盘历史，计算周线 MA 并展示结果
- 每张持仓卡片新增一行**周线状态徽章**：`20周↑/↓`、`30周↑/↓`、`60周↑/↓`（线上 = 绿、线下 = 红；历史不足该周期的显示"数据不足"灰色徽章）
- 新增 `src/lib/weekMa.ts`：
  - 纯函数：日频净值 → 按周重采样（每周末值）、周线 MA、线上/线下判定
  - 拉取编排：按代码形态路由 —— 6 位数字基金复用 `fetchFundNavTrend`（东财 pingzhongdata 全量日频净值），字母代码（美股/ETF 如 QQQ）走 Yahoo 周线接口
- 新增 Pinia store `src/stores/weekMa.ts`：拉取进度、结果缓存、失败重试协调
- 拉取结果持久化到 IndexedDB `meta` store（key = `week-ma-snapshot`，含 fetchedAt），**无 DB 版本迁移**；进入持仓页自动载入最近快照（标注陈旧日期）
- 不修改既有 spec（不动持仓交易、定投、估值、预算、永久组合逻辑）

## Capabilities

### New Capabilities

- `fund-weekly-ma-status`: 持仓周线状态拉取与展示 —— 一键拉取全部持仓的净值历史，按周重采样计算 20/30/60 周均线，展示每只基金当前处于各周期线的线上/线下/数据不足状态，支持缓存与失败重试

### Modified Capabilities

（无。本变更为纯新增，未修改任何既有 spec 的需求。）

## Impact

- **新增文件**：
  - `src/lib/weekMa.ts`（周线重采样 + MA 判定 + 拉取编排）
  - `src/stores/weekMa.ts`
  - `src/components/WeekMaBadges.vue`（持仓卡片徽章行）
  - `src/lib/__tests__/weekMa.test.ts`
- **修改文件**：
  - `src/pages/Portfolio.vue`（顶部按钮 + 卡片徽章挂载）
  - `src/lib/yahoo.ts`（新增 `fetchWeeklyBars`，Yahoo `range=5y&interval=1wk` 走既有代理链）
- **依赖**：无新增 npm 依赖
- **数据源**：东财 pingzhongdata（既有，已验证）+ Yahoo 周线（走既有 CORS 代理链，失败属正常降级路径）
- **存储**：复用 `meta` key-value store，零迁移风险

## Non-Goals

- 不做周线 K 线图 / 走势图（HoldingDetail 已有日线走势图）
- 不基于周线状态自动生成买卖建议（只呈现事实，判断留给用户）
- 不覆盖 HK 等无数据源的持仓（显示"暂不支持"）
- 不做后台定时刷新（用户手动点击）

## Risk

- **pingzhongdata 单文件较大（~281KB/只）**：逐只串行拉取 + 进度提示，避免并发限流
- **Yahoo 代理链不稳定**：字母代码可能拉取失败 → 该持仓显示失败态可单独重试，其余不受影响（沿用 `fetchHoldingPrices` 的容错哲学）
- **新基金历史不足 20/30/60 周**：该周期显示"数据不足"，其他周期照常计算
- **周线口径**：按自然周（ISO 周）取每周最后一个净值；MA 用周末值序列计算；比较基准为最新可得净值/收盘价 —— 在 spec 中钉死，避免歧义
