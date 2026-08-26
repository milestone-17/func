# Tasks: add-fund-weekly-ma-status

## 1. 类型与纯函数（周线计算内核）

- [x] 1.1 在 `src/lib/weekMa.ts` 定义类型：`WeekMaPeriodStatus`（period/ma/position）、`WeekMaRow`（holdingId/symbol/name/lastValue/weekCount/statuses/fetchedAt/error?/unsupported?）、常量 `WEEK_MA_PERIODS = [20, 30, 60] as const`
- [x] 1.2 实现 `isoWeekKey(dateISO): string` —— 纯 UTC 计算 ISO 年-周键（周一为周首，周四定年），不依赖本地时区
- [x] 1.3 实现 `resampleWeekly(points: {date, value}[]): {weekKey, close}[]` —— 按 `isoWeekKey` 分组取每周最后一个有效值，组按周键升序
- [x] 1.4 实现 `weekMaStatuses(weeklyCloses: number[]): WeekMaPeriodStatus[]` —— 逐周期复用 `ma.ts` 的 `computeMA`；判定基准 = 数组末值：`last >= ma` → 'above'，`last < ma` → 'below'，ma 为 null → position null（数据不足）；返回 `weekCount`
- [x] 1.5 写 `tests/unit/weekMa.test.ts`：覆盖 isoWeekKey（跨年边界周）、resampleWeekly（同周多值取末值/乱序输入）、weekMaStatuses（线上/线下/恰好相等记线上/45 周历史时 MA60 为 null/不足 20 周三档全 null）

## 2. 数据拉取层

- [x] 2.1 在 `src/lib/yahoo.ts` 新增 `fetchWeeklyBars(symbol: string, timeout?): Promise<{date, close}[] | null>` —— Yahoo chart `range=5y&interval=1wk`，直连 + 既有 PROXIES 代理链 + `fetchWithTimeout`，复用 `parseYahooChart` 解析；全部失败返回 null 不抛
- [x] 2.2 在 `src/lib/weekMa.ts` 实现 `fetchWeekMaRow(holding): Promise<WeekMaRow>` —— 代码路由：6 位数字 → `fetchFundNavTrend` → `resampleWeekly`；字母 → `fetchWeeklyBars`（bars 视为周收盘，不再重采样）；其余 → `{ unsupported: true }` 不发请求；单只失败捕获为 `error` 字段不抛出
- [x] 2.3 写测试：mock 网络层验证路由分支（6 位数字走 fundQuote、字母走 yahoo、`00700` 类代码返回 unsupported、拉取异常落 error 字段）

## 3. Pinia store 与持久化

- [x] 3.1 新建 `src/stores/weekMa.ts`：state `{ rows: Record<holdingId, WeekMaRow>, loading, progress, fetchedAt }`；getter `rowOf(holdingId)` 与 `hasAnyData`
- [x] 3.2 实现 `fetchAll(holdings)`：有效持仓为 0 时直接返回提示；**串行**逐只 `fetchWeekMaRow`（pingzhongdata 全局变量竞态，禁止并发），每完成一只 `progress++`；完成后整体写 `metaRepo.put({ key: 'week-ma-snapshot', value: { fetchedAt, rows } })`；拉取中重复调用直接返回
- [x] 3.3 实现 `loadFromCache()`：读 `week-ma-snapshot` 回填 state；实现 `retryOne(holdingId, holding)`：单只重拉并更新快照
- [x] 3.4 写测试（fake-indexeddb）：fetchAll 后快照可读回；单只失败不影响其余行写入；retryOne 成功后 error 清除

## 4. UI 组件与页面接入

- [x] 4.1 新建 `src/components/WeekMaBadges.vue`：props `{ row: WeekMaRow }`；三个徽章按 position 上色（线上=emerald、线下=rose、null=灰"数据不足"）；unsupported 显示"暂不支持"；error 显示失败态 + 重试按钮（emit `retry`）；顶部小字"周线截至 YYYY-MM-DD"
- [x] 4.2 修改 `src/pages/Portfolio.vue`：header 新增「周线状态」按钮（loading 转圈 + progress 提示，与既有「拉取全部」并排）；每张持仓卡片在数据网格下方挂载 `<WeekMaBadges>`（无 row 时不渲染徽章区）
- [x] 4.3 `onMounted` 调 `loadFromCache()` 回显快照；展示按当前有效持仓过滤（删除的持仓不显示、新增持仓无徽章）；无任何快照时按钮旁给一行引导文案
- [x] 4.4 全部失败且无缓存时显示错误提示条（沿用 Portfolio 既有 `syncMsg` 样式）

## 5. 验证与收尾

- [x] 5.1 `npm run test` 全绿（新增测试 + 既有回归不破）
- [x] 5.2 `npm run build`（vue-tsc 类型检查）通过
- [x] 5.3 手动验证（`npm run dev`）：有 6 位数字基金持仓 + 至少一个字母代码持仓时点击「周线状态」→ 徽章正确显示线上/线下/数据不足；刷新页面快照回显且标注日期；删除持仓后其徽章消失
