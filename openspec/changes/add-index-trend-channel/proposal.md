# Change: 指数顶底通道（双线买卖区间）

## Why

用户长期跟踪上证指数，用一套手画的"顶线/低线"通道策略做仓位管理（参考同花顺 36 年月 K 截图）：**把历年大底连成低线，把非避雷针的大顶连成顶线**；指数跌到两线中间以下就慢慢买、升到以上就慢慢卖——"铁能赚钱，就是慢了点"。目前这套线只能在行情 App 里手画，本应用缺少一个自动计算并展示该通道的入口。

## What Changes

- 底部任务栏新增第 8 个 Tab「通道」，进入指数顶底通道页
- 新增 `src/lib/indexChannel.ts`：
  - 纯函数通道拟合：月 K 高低点枢轴检测 → **低线** = 历年大底稳健拟合、**顶线** = 大顶拟合且**自动剔除避雷针尖峰**（如上证 2007/6124、2015/5178，按残差离群度识别，最多剔 2 根）
  - 数据拉取：东财 push2his 月 K（`klt=103`）全量历史，JSONP 优先、CORS 代理链兜底
- 新增通道页 `src/pages/Channel.vue`：
  - 指数选择 chips（上证指数为默认，预置沪深300/深证成指/创业板指等，后续想看哪个点哪个）
  - chart.js 长期走势图：月收盘线 + 顶线 + 低线 + 中线（虚线），标注被剔除的避雷针
  - 当前状态卡：当前点位、三线今日数值、通道内位置百分位、区域结论（**低于低线=重仓买入 / 低线~中线=慢慢买 / 中线~顶线=慢慢卖 / 高于顶线=坚决卖**）
- 拉取结果（月 K + 通道参数）持久化到 IndexedDB `meta`（key = `index-channel-<secid>`），零 DB 迁移；重进页面回显并标注数据日期，手动刷新覆盖
- AppShell 底部导航 `grid-cols-7` → 8 列
- 不修改既有 spec（不动持仓/定投/估值/周线状态逻辑）

## Capabilities

### New Capabilities

- `index-trend-channel`: 指数长期顶底通道 —— 拉取指数全量月 K，自动拟合顶线/低线（剔除避雷针尖峰），展示通道图与当前买卖区域结论，支持多指数切换与本地缓存

### Modified Capabilities

（无。本变更为纯新增。）

## Impact

- **新增文件**：
  - `src/pages/Channel.vue`、`src/components/ChannelChart.vue`、`src/components/ChannelStatus.vue`
  - `src/lib/indexChannel.ts`（枢轴检测 + 稳健拟合 + 拉取）
  - `src/stores/channel.ts`
  - `tests/unit/indexChannel.test.ts`、`tests/unit/channelStore.test.ts`
- **修改文件**：
  - `src/router/index.ts`（新增 `/channel` 路由）
  - `src/components/AppShell.vue`（第 8 个 Tab，grid-cols-8）
- **依赖**：无新增 npm 依赖（复用 chart.js / vue / idb）
- **数据源**：东财 push2his K 线接口（月 K，全量 ~432 根/指数，量小）
- **存储**：复用 `meta` key-value store，零迁移风险

## Non-Goals

- 不做自动交易 / 到价提醒推送（只呈现区域结论）
- v1 预置常见 A 股宽基指数，不做任意代码自定义添加（后续可扩展）
- 不做日线/周线/对数坐标切换 v1（固定月 K 线性坐标，与参考图一致）
- 通道参数（枢轴窗口、剔除规则）不做用户可调（内置一套经过验证的口径）

## Risk

- **拟合线与用户手画线不完全一致**：算法口径（枢轴窗口/离群剔除）与肉眼有差异 → 页面标注实际参与拟合的枢轴点与被剔除的避雷针，让结论可校验
- **push2his JSONP `cb` 参数未经本项目验证**：需实测；失败回落 CORS 代理链 fetch（估值/美股模块已验证该模式）
- **拟合算法在短历史指数上退化**（如科创50 仅 ~6 年）：枢轴数不足时该周期显示"历史不足，通道仅供参考"，不阻断
- **8 Tab 布局拥挤**：448px 宽 ÷8 = 56px/个，10px 字号标签可容纳；实现时真机确认
