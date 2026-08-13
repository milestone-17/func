# design.md

## Context

现有数据模型（`src/types/portfolio.ts`、`src/repos/holdingTxnRepo.ts`）已具备 buy/sell 交易与 `computeAvgCost()` 按交易重建数量/均价的能力，但 UI 只有「新增持仓」一条路径（`Portfolio.vue` 的 `save()` 里 `addHolding` + 初始 buy），无加仓/减仓/转换/详情页；周度定投（`stores/dca.ts`）只 `recordExecution()` 记一条执行记录、不生成买入交易；收益按当天现价即时计算，无 T+1/T+2 概念。IndexedDB store 值为 `any`（`db.ts`），新增**可选字段不需要升 schema 版本**。动机见 proposal.md。

## Goals / Non-Goals

**Goals:**
- 对已有持仓加仓/减仓（金额或份额），全部卖出置「已清仓」
- 基金详情页（净值走势/份额/成本/现价/收益/交易记录）+ 加仓/减仓/转换/定投入口
- 超级转换（部分/全部 → 可转给未添加基金并自动建仓），展示确认时间与收益起算
- 按 T+1/T+2 结算：确认中的买入不计入持仓/收益，卖出资金在途显示
- 周度定投绑定目标基金后自动生成真实买入交易，幂等
- 交互与页面形态参考支付宝基金页

**Non-Goals:**
- 不做后台定时任务（纯前端 PWA，浏览器关闭无法执行；沿用现有「打开应用时执行」模式，如实呈现）
- 不做完整交易日历/节假日；周末跳过、法定节假日按普通日近似
- 不做真实下单/对接基金公司 API；本应用为记账/估值工具，交易生成的是本地交易记录
- 不重构现有 `computeAvgCost` 的公开行为（保留兼容），新增结算感知的重建函数
- 不引入新外部依赖

## Decisions

### D1. 结算状态运行时推算，不加交易字段
`HoldingTxn` 不新增字段。结算状态由 `txn.date + holding.settleDays` 运行时推算（`confirmDate = addTradingDays(date, settleDays)`，跳过周六日）。理由：与现有「由交易重建持仓」哲学一致（`computeAvgCost` 每次现算），无需迁移历史数据——历史交易日期都在过去，天然全部已确认；也避免用户改 `settleDays` 后已存状态过期。

- 新增 `src/lib/settlement.ts`：`addTradingDays(dateISO, n)`（跳过周末）、`confirmDateOf(date, settleDays)`、`isSettled(txn, settleDays, todayISO)`。
- 交易日近似：仅跳周末，无节假日日历——文档化为已知近似（spec 已声明）。

### D2. 持仓重建：新增结算感知 `computePosition`，`computeAvgCost` 保留
`computeAvgCost` 保持原语义（所有交易计入，供既有测试/兼容）。新增 `src/lib/position.ts` 的 `computePosition(txns, settleDays, todayISO)`：
- 已确认的 buy 累加数量与成本；未确认 buy 的 `amount` 计入 `pendingBuyFen`（在途资金），不计入数量。
- 已到账的 sell 按现价累减数量与成本；未到账 sell 的份额仍计入数量（冻结 `frozenShares`），其金额计入 `pendingSellFen`。
- 返回 `{ quantity, avgCost, pendingBuyFen, pendingSellFen, frozenShares }`。
- `portfolio.refresh()` 改用 `computePosition`；`HoldingView` 增加 `pendingBuyFen / pendingSellFen / frozenShares / isClosed`。

`settleDays` 解析（`settleDaysOf(h)`）：`h.settleDays ?? (6位基金代码或 CN 基金 → 1 : 0)`。存量美股持仓（无 settleDays）→ 0（即时），**存量行为零变化**；存量/新建基金 → 1（QDII 名称 → 2）。新建基金时把 `settleDays` 显式落库（可编辑）。

**替代方案**：在 `HoldingTxn` 上加 `status/confirmedAt` 字段。否决：需迁移、改字段后状态会过期、与重建哲学不符。

### D3. 加仓/减仓 = 复用交易模型 + 新 store action
`stores/portfolio.ts` 新增：
- `addPosition(id, { mode: 'amount'|'shares', value, feeFen?, date? })`：金额→份额 = 金额/净值；净值取 `holding.currentPrice`（无则拒绝并提示拉取/填价）；生成 buy 交易。
- `reducePosition(id, { mode: 'amount'|'shares'|'all', value, feeFen?, date? })`：校验份额 ≤ 当前已确认数量、金额 ≤ 市值；生成 sell 交易；若后数量为 0 → `isClosed`（保留记录，见 D5）。
- 净值缺失时的金额折算用「最近现价」，与定投/转换共用 `resolvePrice(h)`。

### D4. 转换 = sell 源 + buy 目标，目标可自动建仓
`src/lib/conversion.ts` 纯函数 `planConversion(...)` 负责计算，store 负责落库：
- 输入：源持仓、转出份额或金额（`all` 表示全部）、目标（代码/名称/净值）、费用、结算天数。
- 输出：源 sell（金额 = 份额×源净值）、目标 buy（份额 = 净额/目标净值）、以及「转出确认日 / 转入确认日 / 收益起算日」文案（按双方 settleDays 推算）。
- 目标代码输入时调用 `fetchFundNavs([code])` / `fetchHoldingPrice` 自动带出名称、净值；6 位代码 → CN/CNY、`settleDays=suggestSettleDays(name)`；字母 → US/USD、T+0。目标不存在则先 `holdingRepo.add` 建仓（复用 `addHolding` 的分类推断）。
- 校验：源≠目标、转出份额 ≤ 持有、源净值/目标净值可用。失败不落库。
- 同一基金转换拒绝。

### D5. 全部卖出不软删，显示「已清仓」
全部卖出生成 sell 交易后持仓保留（数量 0 + `isClosed` 标签），便于看到在途资金与恢复加仓；既有「删除」按钮仍是主动软删路径。已在 spec（fund-trading 全部卖出场景）同步该语义。

### D6. 详情页独立路由 + 净值走势
- 新路由 `/holding/:id`，`src/pages/HoldingDetail.vue`；投资页卡片整体可点击跳转。
- 净值走势：扩展 `fundQuote.ts` 新增 `fetchFundNavTrend(code)`，解析 `pingzhongdata` 的 `Data_netWorthTrend` 全量历史（现有 `fetchFundNavByPingzhongdata` 只取末位），非 6 位代码返回 null → 空态。图表复用 `LineChart`。
- 底部固定操作栏：加仓 / 减仓 / 转换 / 定投（支付宝基金页同款四个入口）。
- 定投入口：跳 `/dca?target=<holdingId>`，每日定投卡片预选该持仓（`DailyDcaCard` 读取 query 预填）。

### D7. 周度定投绑定目标基金 + 自动执行
- `DCAConfig` 增加可选 `targetHoldingId`；`Dca.vue` 配置抽屉增加「目标基金」下拉（可选持仓）。
- `stores/dca.ts` 新增 `runAutoExecutions()`（Dca 页 `onMounted` 在 `load()` 后调用）：对每个已配置且有 `targetHoldingId` 的标的，按 `weekOfMonth(today)` 判定周期；若 `dcaExecutionRepo` 无该 `(configId, month, weekIndex)` 记录且目标基金有净值 → 用 `computeWeekSuggestion` 建议金额生成 buy 交易 + `recordExecution`；无净值则跳过并提示，不标记已执行。
- `recordExecution()` 扩展：当 `config.targetHoldingId` 存在时，额外向该持仓生成 buy 交易（按 `actualPrice ?? holding.currentPrice` 折算份额），保持「执行=真实买入」一致性。
- 幂等：`dcaExecutionRepo` 的周期记录即「本周已执行」标记，重复打开不再买入（spec 场景已覆盖）。
- 每日定投沿用 `runIfPending()`；其买入天然带结算（D1），无需改 `computeDailyBuy` 核心逻辑，仅补 `settleDays` 读取。

### D8. UI 参考支付宝基金页（页面形态）
- 详情页版式：顶部基金信息卡（名称/代码/分类标签/净值估算）→ 净值走势卡 → 持有收益卡（份额/市值/收益/收益率/成本）→ 交易记录列表 → 底部固定操作栏（加仓/减仓/转换/定投）。
- 操作抽屉统一：顶部标题 + 金额/份额切换 + 净值与预计确认份额实时预览 + 手续费行 + 「确认」主按钮，与现有 sheet 组件风格一致。
- 转换抽屉：转出侧（份额/金额/全部）→ 转入侧（代码输入自动识别名称净值）→ 结果预览（转出份额、净额、转入确认份额、转出/转入确认日、收益起算日）。

## Risks / Trade-offs

- [交易日近似无节假日日历] → 周末正确、节假日可能偏差一天；文档化，spec 已声明；后续可引入交易日历数据替换 `addTradingDays`。
- [运行时推算结算需每次传 `todayISO`] → 测试注入 `todayISO`，生产用 `new Date()`；`computePosition` 为纯函数，单测全覆盖。
- [存量持仓 `settleDays` 缺失按 0（即时）] → 存量行为零变化，风险最低；新建基金显式落库。
- [周度定投自动执行仅在打开 DCA 页时触发] → 与每日定投一致的既有限制，如实提示「打开应用时执行」。
- [自动建仓转换可能重复创建目标持仓] → 建仓前按 `symbol` 查重，已存在则复用。
- [净值走势依赖 pingzhongdata 外链，可能失败] → 失败显示空态不报错（spec 已含）。
- [改 schema 不升版本] → 新增字段全部可选，IndexedDB 记录按 `any` 存取，无需 `upgrade()`；零数据迁移风险。

## Migration Plan

1. 纯新增：`settlement.ts`、`position.ts`、`conversion.ts`、`HoldingDetail.vue`、`suggestSettleDays`。
2. 类型加可选字段：`Holding.settleDays?`、`DCAConfig.targetHoldingId?`、`HoldingTxn` 不变——无需 DB 迁移，`SCHEMA_VERSION` 保持 2。
3. 行为开关：`portfolio.refresh()` 切到 `computePosition` 后，存量基金历史交易日期均为过去 → 全部已确认，持仓数字不变；仅当日新建基金交易出现「确认中」。
4. 回滚：字段可选、函数可独立回退；`computeAvgCost` 保留即回滚开关。

## Open Questions

（无。各决策已在 D1–D8 落地，未留会改变 spec/任务拆分的未知项。）
