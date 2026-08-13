# tasks.md

## 1. 结算基础（lib/settlement.ts）

- [x] 1.1 新增 `src/lib/settlement.ts`：纯函数 `addTradingDays(dateISO, n)`——按天推进、跳过周六周日，返回确认日 ISO 字符串
- [x] 1.2 `confirmDateOf(dateISO, settleDays)` 与 `isSettled(txn, settleDays, todayISO)`：确认日 ≤ 今天判定「已确认/已到账」
- [x] 1.3 新增 `suggestSettleDays(name)`：名称含跨境关键词（纳指/纳斯达克/标普/恒生/中概/海外/全球/美国/日经/德国/原油/QDII 等）→ 2，否则 1
- [x] 1.4 单测：`addTradingDays` 跨周末（周四+1→周五、周四+2→下周一）、`isSettled` 边界（等于确认日即已确认）

## 2. 持仓重建（lib/position.ts + 类型）

- [x] 2.1 新增 `src/lib/position.ts`：纯函数 `computePosition(txns, settleDays, todayISO)`——已确认 buy 累数量/成本；未确认 buy 金额入 `pendingBuyFen`；未到账 sell 份额冻结（`frozenShares`）、金额入 `pendingSellFen`，到账后扣数量/成本
- [x] 2.2 `Holding` 增加可选 `settleDays?`；`HoldingView` 增加 `pendingBuyFen / pendingSellFen / frozenShares / isClosed`
- [x] 2.3 新增 `settleDaysOf(h)`：`h.settleDays ?? (6位基金代码或CN基金 ? 1 : 0)`；新建基金时落库 `settleDays = suggestSettleDays(name)`
- [x] 2.4 `portfolio.refresh()` 改用 `computePosition`（`computeAvgCost` 保留兼容）；`isClosed` = 数量 0 且有过交易
- [x] 2.5 单测：确认中买入不计数量/收益、在途卖出冻结显示、存量持仓（无 settleDays）行为不变

## 3. 加仓 / 减仓（fund-trading）

- [x] 3.1 store 新增 `addPosition(id, {mode:'amount'|'shares', value, feeFen?, date?})`：金额→份额=金额/净值，无净值拒绝并提示；生成 buy 交易
- [x] 3.2 store 新增 `reducePosition(id, {mode:'amount'|'shares'|'all', value, feeFen?, date?})`：校验份额≤已确认数量、金额≤市值；生成 sell 交易；数量归零置 `isClosed`
- [x] 3.3 投资页持仓卡片增加「加仓/减仓」入口与抽屉表单（金额/份额切换、手续费、净值与预计份额实时预览、全部卖出）
- [x] 3.4 校验测试：减仓超额拒绝、无净值加仓提示、加仓/减仓后 `computePosition` 一致

## 4. 超级转换（fund-conversion）

- [x] 4.1 新增 `src/lib/conversion.ts` 纯函数 `planConversion(...)`：输入源持仓/转出份额或金额/目标净值与 settleDays/费用，输出源 sell + 目标 buy + 转出/转入确认日与收益起算日
- [x] 4.2 store 新增 `convertPosition(fromId, target, opts)`：按 symbol 查重目标持仓（不存在则 `addHolding` 建仓并推断分类/结算），落库 sell+buy 两条交易；源==目标或超额拒绝
- [x] 4.3 转换抽屉 UI：转出份额/金额/全部 → 转入代码输入自动识别名称/净值（6位→CN/CNY、字母→US/USD）→ 结果预览（净额、转入份额、确认时间）；支持目标为未添加基金
- [x] 4.4 单测：部分/全部转换、转未添加基金自动建仓、源==目标拒绝、超额拒绝、费用折算

## 5. 基金详情页（fund-detail-view）

- [x] 5.1 `fundQuote.ts` 新增 `fetchFundNavTrend(code)`：解析 pingzhongdata 全量 `Data_netWorthTrend` 返回 `{date, nav}[]`；非 6 位返回 null
- [x] 5.2 新增路由 `/holding/:id` 与 `src/pages/HoldingDetail.vue`：顶部基金信息卡（名称/代码/分类/净值）、净值走势图（复用 LineChart，无数据空态）、持有收益卡（份额/市值/成本/现价/收益/收益率）、在途资金与冻结份额标注、交易记录列表（方向/份额/价格/金额/确认状态）
- [x] 5.3 底部固定操作栏：加仓/减仓/转换/定投四入口；定投跳 `/dca?target=<holdingId>` 并由每日定投卡片预选
- [x] 5.4 投资页卡片可点击进入详情；`isClosed` 显示「已清仓」标签
- [x] 5.5 e2e：详情页打开、加仓/减仓流、转换流（含目标自动建仓）

## 6. 定投自动执行（dca-auto-execution）

- [x] 6.1 `DCAConfig` 增加可选 `targetHoldingId`；`Dca.vue` 配置抽屉增加「目标基金」下拉（可选持仓）
- [x] 6.2 `recordExecution()` 扩展：`config.targetHoldingId` 存在时按目标基金净值生成 buy 交易（`actualPrice ?? holding.currentPrice`，无净值则跳过不标记已执行）
- [x] 6.3 `stores/dca.ts` 新增 `runAutoExecutions()`：按 `weekOfMonth(today)` 判定周期，`dcaExecutionRepo` 无该 `(configId, month, weekIndex)` 记录时按建议金额自动执行（幂等）；`Dca.vue onMounted` 在 `load()` 后调用
- [x] 6.4 单测：周度自动买入生成交易、无净值跳过、周期内重复打开不重复、每日定投买入带结算确认

## 7. 集成验证与上线

- [x] 7.1 `npm run test` 全绿（新增结算/持仓/交易/转换/定投单测 + 不破坏既有）
- [x] 7.2 `npm run build`（vue-tsc + vite）通过
- [x] 7.3 `npm run test:e2e` 通过，无未预期控制台错误
- [x] 7.4 提交推送上线，手机真机验证：详情页、加仓/减仓、转换、定投自动执行、T+1/T+2 确认展示
