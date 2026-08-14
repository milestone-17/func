# Tasks: add-valuation-percentile-recommendation

## 1. 类型与内置标的常量

- [x] 1.1 在 `src/types/valuation.ts` 新增 `ValuationRow` / `ValuationSnapshot` / `Bucket` / `SortMode` 类型
- [x] 1.2 在 `src/lib/valuation.ts` 顶部硬编码内置标的列表 `BUILTIN_SYMBOLS`：6 个宽基指数（沪深 300 / 中证 500 / 中证 1000 / 创业板指 / 科创 50 / 上证 50）+ 至少 10 个申万一级行业，每个含 `code, name, kind: 'index' | 'industry'`
- [x] 1.3 在 `src/lib/valuation.ts` 导出常量 `FIVE_BUCKETS`（5 档定义数组）

## 2. 纯函数逻辑（含单测）

- [x] 2.1 实现 `computePercentile(series, current)` —— 边界：空序列 → null；序列仅 1 个元素且 == current → 50；全部相同值 → 50；含 null/0/负值 → 过滤后计算
- [x] 2.2 实现 `bucketByPercentile(p)` —— 严格按 spec 的 5 档边界（< 20 / 20-40 / 40-60 / 60-80 / > 80）
- [x] 2.3 实现 `parseEastmoneyKline(payload)` —— 纯函数，解析 `push2his.eastmoney.com` K 线返回的 `pe_ttm` 序列
- [x] 2.4 实现 `parseEastmoneySnapshot(payload)` —— 解析 `push2.eastmoney.com` 单标的快照
- [x] 2.5 写 `tests/unit/valuation.test.ts`：覆盖 computePercentile、bucketByPercentile、parseEastmoneyKline、parseEastmoneySnapshot、matchesSearch、BUILTIN_SYMBOLS

## 3. 数据拉取层

- [x] 3.1 在 `src/lib/valuation.ts` 实现 `fetchKline(symbol, days = 2400)` —— JSONP 拉 K 线
- [x] 3.2 实现 `fetchSnapshot(symbol)` —— JSONP 拉快照
- [x] 3.3 实现 `fetchOne(symbol)` —— 组合：snapshot + kline → percentile → bucket

## 4. DB Schema 升级

- [x] 4.1 修改 `src/repos/db.ts`：`func-db` 版本从 2 升到 3；`upgrade` callback 内 `if (oldVersion < 3)` 加 `valuationSnapshots` store
- [x] 4.2 在 `src/repos/valuationRepo.ts` 顶部声明 `STORE_VALUATION_SNAPSHOTS = 'valuationSnapshots'`
- [x] 4.3 新建 `src/repos/valuationRepo.ts`：导出 `put` / `getByDate` / `listRecent` / `getLatest` / `getWithinDays`；主键 `id = 'YYYY-MM-DD'`

## 5. Pinia Store

- [x] 5.1 新建 `src/stores/valuation.ts`：`state` 包含 `rows`, `progress`, `loading`, `sortMode`, `search`, `lastFetchedAt`, `staleDate`
- [x] 5.2 实现 `action fetchAll()`：串行 `fetchOne` 每个内置标的，每完成一个更新 `progress`；完成后 `valuationRepo.put` 写当日快照；全部失败时降级到陈旧快照
- [x] 5.3 实现 `action loadFromCache()`：检查 7 天内快照
- [x] 5.4 实现 `action retryOne(code)`：单独重跑该标的
- [x] 5.5 实现 `getter displayedRows`：先按 `search` 过滤，再按 `sortMode` × direction 排序
- [x] 5.6 实现 `getter summary`：返回 `{ lowest, highest, count, failCount }`

## 6. UI 组件

- [x] 6.1 新建 `src/components/SuggestionTable.vue`：表格 + 行底色按 bucket 上色 + 分位 ProgressBar
- [x] 6.2 新建 `src/components/SuggestionToolbar.vue`：搜索框 + 排序模式切换 pill + 拉取按钮
- [x] 6.3 新建 `src/components/SuggestionSummary.vue`：最低估 / 最高估 / 拉取时间 三张卡

## 7. 页面

- [x] 7.1 新建 `src/pages/Suggest.vue`：组合 Toolbar / Summary / Table；`onMounted` 调 `loadFromCache()`；点击"拉取"调 `fetchAll()`；失败时显示错误 toast
- [x] 7.2 进度条：顶部细条绑定 `progress`
- [x] 7.3 空状态：完全无数据且未拉取时显示"暂无数据，点击右上角拉取"

## 8. 路由与底部导航

- [x] 8.1 修改 `src/router/index.ts`：新增 `{ path: '/suggest', name: 'suggest' }`
- [x] 8.2 修改 `src/components/AppShell.vue`：`tabs` 数组插入「建议」(lightbulb 图标)；底部 grid 改为 `grid-cols-7`；新增 lightbulb SVG 描边图标

## 9. 测试与验收

- [x] 9.1 写 `tests/unit/valuation.test.ts` 单元测试
- [x] 9.2 更新 `tests/unit/db.test.ts`：SCHEMA_VERSION 升到 3、新增 `valuationSnapshots` store 断言、v1→v3 升级保留数据
- [ ] 9.3 `npm test` 跑全量, 全部通过
- [ ] 9.4 `npm run build` 无 TS 错误
- [ ] 9.5 手测清单 (dev 模式 + 浏览器)
- [ ] 9.6 部署到 GitHub Pages 后, 手机浏览器验证 PWA 离线缓存 + 底部 Tab 第 6 项入口可点

