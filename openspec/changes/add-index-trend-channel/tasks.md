# Tasks: add-index-trend-channel

## 1. 类型与预置常量

- [x] 1.1 在 `src/lib/indexChannel.ts` 定义类型：`MonthlyBar { date, open, close, high, low }`、`ChannelLine { slope, intercept, fromT, toT }`、`PivotPoint { t, date, value }`、`Channel { top, bottom, pivotHighs, pivotLows, excludedSpikes, lowConfidence }`、`Zone = 'strong-buy' | 'buy' | 'sell' | 'strong-sell'`
- [x] 1.2 导出预置指数常量 `PRESET_INDICES`: 上证指数 `1.000001`（默认）、深证成指 `0.399001`、沪深300 `1.000300`、中证500 `1.000905`、创业板指 `0.399006`、科创50 `1.000688`，各含 `secid/name`
- [x] 1.3 导出口径常量 `PIVOT_WINDOW_K = 6`、`MAX_EXCLUDED_SPIKES = 2`、`SPIKE_MAD_MULT = 3`、`MIN_PIVOTS = 6`、`MIN_MONTHS = 60`

## 2. 拟合内核纯函数（含单测）

- [x] 2.1 实现 `parsePush2hisKline(payload): MonthlyBar[]` —— 解析 `data.klines`（逗号分隔 `日期,开,收,高,低`），升序，非法行跳过
- [x] 2.2 实现 `findPivots(bars, k): { highs: PivotPoint[], lows: PivotPoint[] }` —— ±k 月分形极值 + 同型间距 <2k 去重保更极端
- [x] 2.3 实现 `theilSenSlope(points): number` —— 点对斜率中位数
- [x] 2.4 实现 `fitChannel(bars): Channel` —— 顶线：MAD 离群剔除 ≤2 正残差避雷针 → Theil-Sen 斜率 + `max(y−slope·t)` 截距；低线：Theil-Sen 斜率 + `min(y−slope·t)` 截距；枢轴 <MIN_PIVOTS 或月数 <MIN_MONTHS → `lowConfidence`
- [x] 2.5 实现 `zoneOf(close, channel, tNow): { zone: Zone, posPct: number, top: number, mid: number, bottom: number }` —— pos% 钳 0–100，四区判定
- [x] 2.6 写 `tests/unit/indexChannel.test.ts`：合成 36 年月 K（已知斜率底/顶 + 注入 2 根 3× 避雷针）验证——解析器、枢轴检出、斜率近似真值、避雷针被剔除且 ≤2、包络性质（各非剔除高点 ≤ 顶线、各低点 ≥ 低线）、pos%/四区分界（含钳制）、lowConfidence（短历史）

## 3. 数据拉取层

- [x] 3.1 `fundQuote.ts` 导出既有 `jsonpGet`；`yahoo.ts` 导出既有 `PROXIES` 与 `fetchWithTimeout`（仅加 export，不改行为）
- [x] 3.2 实现 `fetchMonthlyBars(secid): Promise<MonthlyBar[] | null>` —— push2his `klt=103` URL，先 JSONP `cb=`，失败回落代理链 fetch；全失败返回 null 不抛
- [x] 3.3 实测验证 push2his `cb` JSONP 可用性（node/curl 单测或临时脚本记录结论，写进代码注释）；解析复用 `parsePush2hisKline`
- [x] 3.4 写测试：mock JSONP 成功路径 / JSONP 失败走代理链 / 双失败返回 null

## 4. Pinia store 与持久化

- [x] 4.1 新建 `src/stores/channel.ts`：state `{ selection: string, byIndex: Record<secid, { bars, channel?, fetchedAt, error? }> }`；action `loadFromCache(secId)`（meta `index-channel-<secid>`）、`selectIndex(secId)`（持久化 `index-channel-selection`）、`refresh(secId, { force })`、`retry(secId)`
- [x] 4.2 `refresh`：无缓存或 force → `fetchMonthlyBars` → `fitChannel` → JSON round-trip 后写 meta；失败写 error 不抛；有缓存时先回显再后台刷新覆盖
- [x] 4.3 写 `tests/unit/channelStore.test.ts`（fake-indexeddb）：拉取后快照可读回、error 不覆盖已有 channel、选择持久化恢复、两指数缓存互不串

## 5. UI 组件与页面

- [x] 5.1 新建 `src/components/ChannelChart.vue`：chart.js Line 四数据集（月收 brand / 顶线 rose / 低线 amber / 中线虚线 ink3），两线自首个拟合枢轴画至今日，X 轴抽稀，避雷针月份加标记点
- [x] 5.2 新建 `src/components/ChannelStatus.vue`：区域结论卡（四区配色）+ 当前点位 + 三线今日数值 + pos%；lowConfidence 时标注"历史不足，仅供参考"；error 时失败态 + 重试按钮（emit）
- [x] 5.3 新建 `src/pages/Channel.vue`：指数 chips（默认上证）+ 图 + 状态卡；onMounted 载入选择与缓存、后台刷新；切换 chip 即加载；被剔除避雷针列表（日期+点位）折叠可查

## 6. 路由与底部导航

- [x] 6.1 `src/router/index.ts` 新增 `/channel` 懒加载路由
- [x] 6.2 `AppShell.vue` tabs 加第 8 项「通道」，`grid-cols-7` → `grid-cols-8`（静态类名）

## 7. 验证与收尾

- [x] 7.1 `npm run test` 全绿（新增测试 + 既有回归不破）
- [x] 7.2 `npm run build`（vue-tsc）通过
- [x] 7.3 Playwright 手动验证（dev + mock 传输层）：上证默认加载、双线/中线/避雷针标记渲染、区域结论正确；切换创业板指独立加载；刷新页面缓存回显+截至标注；底部 8 Tab 布局不溢出（截图确认）
- [x] 7.4 真机/截图复核 8 Tab 视觉（宽度、字号、图标），必要时微调
