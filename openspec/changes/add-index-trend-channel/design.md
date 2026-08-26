# Design: 指数顶底通道（双线买卖区间）

## Context

参考图为同花顺上证指数 36 年月 K：低线连 998→1849→2440→2863 等大底，顶线由非避雷针大顶决定、2007/6124 与 2015/5178 两根尖峰刺穿在线上方。现有可复用资产：`fundQuote.ts` 的 `jsonpGet`（私有）与 `yahoo.ts` 的 `fetchWithTimeout`（私有）；chart.js 已注册 LinearScale/CategoryScale/Filler；`metaRepo` key-value 存储（weekMa 快照同模式）；AppShell 底部导航 `grid grid-cols-7` 写死。

## Goals / Non-Goals

**Goals:**

- 纯函数拟合内核 100% 可单测（合成数据验证斜率/包络/避雷针剔除）
- 顶线/低线自动计算，结论可校验（枢轴点与被剔除尖峰可见）
- 多指数独立缓存，切换秒开

**Non-Goals（设计层面）:**

- 不做枢轴窗口/剔除阈值用户可调（内置一套口径，参数以常量集中便于后续调）
- 不做对数坐标拟合（与参考图线性口径一致；对数作为备选记录见 D2）

## Decisions

### D1: 数据源与拉取通路 — 东财 push2his 月 K，JSONP 优先 + 代理链兜底

`push2his.eastmoney.com/api/qt/stock/kline/get?secid=<secid>&klt=103&fqt=1&beg=0&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55`（f51 日期 / f53 收 / f54 高 / f55 低），月 K 全量 ~432 根，量小。

- 优先 JSONP（`&cb=<回调名>`，复用 `fundQuote.ts` 的 `jsonpGet`，**导出复用**而非复制）；`cb` 参数未在本项目验证过 → 任务中含实测，失败即回落
- 兜底：`yahoo.ts` 的 PROXIES 代理链 + `fetchWithTimeout`（**导出复用**）
- 预置指数（secid）：上证指数 `1.000001`（默认）、深证成指 `0.399001`、沪深300 `1.000300`、中证500 `1.000905`、创业板指 `0.399006`、科创50 `1.000688`

### D2: 拟合空间用线性价格坐标（与参考图一致）

36 年 95→6124 跨 64 倍，对数坐标数学性质更好（恒定增长率通道），但用户参考图与心智模型是线性手画线，且其策略本身就在线性视觉下成立。v1 线性；若未来出现早期数据被压扁的观感问题，再评估对数（备选，不改 spec 行为——通道定义不变，仅坐标变换）。

### D3: 拟合算法 — 枢轴检测 + Theil-Sen 斜率 + 包络截距 + 显式避雷针剔除

分三步，全部纯函数（`fitChannel(bars) → Channel`）：

1. **枢轴检测**：`k=6`（±半年）分形窗口——`high[i]` 是 `high[i−6..i+6]` 最大值 → 枢轴高点；低点对称。同型枢轴间距 < 2k 时保留更极端者。36 年约产出 10–20 个/侧。
2. **斜率（Theil-Sen，中位数斜率）**：对所有枢轴点对 `(t1,y1),(t2,y2)` 取斜率中位数。对 ≤29% 离群天然稳健——两根避雷针（2/15 ≈ 13%）无法拉动斜率。`t` 轴 = 距首月月数（整数，数值小）。
3. **截距（包络语义）+ 避雷针剔除**：
   - 顶线：初步残差 `r_i = y_i − (slope·t_i + median_intercept)`；用 MAD 判离群（`r_i > median + 3·MAD`），**最多剔除 2 个最大正残差点**（即避雷针）；截距取剩余点 `max(y_i − slope·t_i)` → 直线触最高非避雷针顶、其余顶在线下，避雷针刺穿线上方（与参考图一致）
   - 低线：不做剔除（用户口径底部无避雷针）；截距取 `min(y_i − slope·t_i)` → 线托住全部历史底

```ts
interface ChannelLine { slope: number; intercept: number; fromT: number; toT: number }
interface Channel {
  top: ChannelLine; bottom: ChannelLine
  pivotHighs: { t: number; date: string; value: number }[]
  pivotLows:  { t: number; date: string; value: number }[]
  excludedSpikes: { t: number; date: string; value: number }[]  // 被剔除的避雷针 (≤2)
  lowConfidence: boolean   // 枢轴数不足 (如 <6 个/侧) → “历史不足，仅供参考”
}
```

**历史不足降级**：任一侧可用枢轴 < 6 或历史 < 60 个月 → `lowConfidence = true`，页面标注，不阻断展示。

### D4: 区域结论与百分位

- `pos% = (最新收 − bottom(t_now)) / (top(t_now) − bottom(t_now)) × 100`，钳制 0–100
- 四区（用户口径"中间以下慢慢买、以上慢慢卖"+ 两端加强）：`< 低线` 重仓买入 / `低线–中线` 慢慢买 / `中线–顶线` 慢慢卖 / `> 顶线` 坚决卖
- 状态卡同时给当前点位、三线今日数值、pos%

### D5: Store 与持久化 — weekMa 同模式，按指数独立 key

`stores/channel.ts`：`state = { selection, byIndex: Record<secId, IndexChannelData> }`，`IndexChannelData = { bars, channel, fetchedAt, error? }`。
meta 两个 key：`index-channel-selection`（上次选择）、`index-channel-<secid>`（月 K + 通道 + fetchedAt，JSON round-trip 剥响应式后 put，同 weekMa 的 DataCloneError 教训）。进入页面：回显缓存（标注"数据截至 YYYY-MM"）→ 后台刷新 → 覆盖。

### D6: 图表与导航接入

- `ChannelChart.vue`：chart.js Line 四数据集——月收盘（brand 实线）、顶线（rose）、低线（amber）、中线（虚线 ink3）；两线自首个参与拟合枢轴画至今日（手画线习惯，不画到图左缘）；X 轴 `YYYY-MM` 标签抽稀（每 12/24 月一个 tick）保证 430+ 月可读
- `ChannelStatus.vue`：区域结论卡（四色）
- AppShell：`grid-cols-7` → `grid-cols-8`（**静态类名**，Tailwind JIT 不识别动态拼接，tabs 数组加第 8 项）；图标用趋势通道类 svg（activity/trending-up 变体）
- 路由 `/channel`，页面懒加载同既有模式

## Risks / Trade-offs

- [Theil-Sen O(n²) 点对] → 每侧枢轴 ≤ ~25 个，点对 ≤ 300，可忽略；纯函数无性能风险
- [拟合结果与用户手画线存在差异] → 页面列出枢轴点与被剔除避雷针（可校验），口径参数集中为常量便于后续微调
- [push2his `cb` JSONP 未验证] → 实测任务前置；失败回落代理链（估值/美股已验证模式），双通路均有测试（mock JSONP/ fetch）
- [早期单边下跌段（如创业板 2015 后）拟合出下降通道] → 属数据事实，如实展示；区域结论语义不变（低线以下=重仓买入仍成立）
- [8 Tab 拥挤] → 56px/项 × 10px 标签可容纳；实现后真机/截图验证，必要时标签缩到 2 字

## Migration Plan

纯新增（路由/页面/lib/store/测试）+ AppShell、router 两处小改；无 DB 迁移。回滚 = revert 提交。
