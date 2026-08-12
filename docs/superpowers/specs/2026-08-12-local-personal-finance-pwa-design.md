# 本地个人财务 PWA — 设计文档

- 日期：2026-08-12
- 状态：待用户审阅
- 范围：单用户、单设备-主、手机优先、本地优先的 PWA

---

## 1. 背景与目标

用户需要一个"在手机上用"的本地化个人财务工具，覆盖 5 项核心功能：

1. 日常花销与收入记录（流水）
2. 每月收入的预算分配
3. 股票投资持仓与收益记录
4. 永久投资组合（Harry Browne 经典 25/25/25/25）的偏离建议
5. 纳斯达克 100 智能定投（基于 250 日均线 + 档位表）

设计原则：**数据永远在用户设备上**（IndexedDB），应用代码可静态托管但不携带任何用户数据；离线可用；可装到手机主屏。

## 2. 非目标 (Non-Goals)

- 不做云同步 / 多设备同步
- 不做多人 / 多账户
- 不做银行/券商自动对接
- 不做加密货币实时链上数据
- 不做税务计算 / 报税辅助
- 不做社交 / 分享
- 不做通知推送（v1）
- 不做 i18n（仅中文）
- 不做密码/生物识别（数据本地化已足够，v1 不上 PIN）
- 不做 Web 端深色模式（v1 跟随系统）

## 3. 用户与场景

- **单用户**：自己用，不登录
- **单账户**：不区分零钱/工资卡/股票账户（v1）
- **币种**：CNY + USD（QQQ 用 USD 计，其他默认 CNY）
- **设备**：手机为主，电脑开发；UI 优先手机视口
- **网络**：可能离线，必须离线可用
- **数据安全**：所有数据手机本地 IndexedDB；备份/恢复靠手导出 JSON

## 4. 架构

### 4.1 总体

```
┌─────────────────────────────────────────────────┐
│  手机 (浏览器 / PWA)                            │
│  ┌───────────────────────────────────────────┐  │
│  │  Vue 3 SPA                                │  │
│  │  ├─ 路由: 5 模块 + 设置                    │  │
│  │  ├─ 状态: Pinia (5+1 store)               │  │
│  │  ├─ 存储: IndexedDB (via idb, 10 store)   │  │
│  │  └─ 缓存: Workbox (PWA service worker)     │  │
│  └───────────────────────────────────────────┘  │
└──────────────┬──────────────────────────────────┘
               │ HTTPS
   ┌───────────┴────────────┐
   ▼                        ▼
GitHub Pages           stooq.com (CSV)
(静态资源)              (QQQ/NDX 历史价)
```

### 4.2 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Vue 3 (`<script setup>`) | SFC 单文件组件，5 模块各 1–3 个 .vue 拆得清 |
| 构建 | Vite 5 | `npm run dev` / `npm run build` 一致体验 |
| PWA | vite-plugin-pwa (Workbox) | 自动 manifest + service worker + 缓存策略 |
| 状态 | Pinia | Vue 官方，5+1 store 各自独立 |
| 路由 | vue-router 4 | 6 路由 (5 模块 + 设置) |
| 存储 | IndexedDB via `idb` | 大容量、支持索引、Promise API、类型友好 |
| 图表 | Chart.js + vue-chartjs | 主流、稳定、轻量 |
| 测试 | Vitest + @vue/test-utils + happy-dom | Vite 原生、极快 |
| 部署 | GitHub Pages | 免费、HTTPS、PWA 完整功能 |

包体估算（gzipped）：Vue + 路由 + Pinia + idb + app code ≈ 80–120 KB，首屏 < 1s。

### 4.3 路由

```
/dashboard    首页（今日/本月概览）
/ledger       1. 流水
/budget       2. 月预算分配
/portfolio    3. 持仓与股票收益
/permanent    4. 永久组合建议
/dca          5. 智能定投
/settings     设置（数据/导入导出/API/币种）
```

手机导航：底部 Tab 栏（5 主功能入口），设置从右上角齿轮进入。Tab 顺序：流水 → 智能定投 → 永久组合 → 持仓 → 预算。

## 5. 模块与组件

### 5.1 模块职责

| 模块 | 主视图 | 子视图 | 关键交互 |
|---|---|---|---|
| 流水 | 月历 + 当日明细 | 记一笔（单条） | 长按删除、左滑编辑、批量分类 |
| 预算 | 本月预算仪表盘 | 分配调整 | 拖动百分比、预算 vs 实际对比 |
| 持仓 | 持仓列表 + 总收益 | 加仓/编辑/历史 | 实时价刷新、收益曲线 |
| 永久组合 | 4 类资产饼图 + 偏离条 | 资产编辑 | 偏离超阈值红色高亮、再平衡建议 |
| 智能定投 | 本月定投面板 + 4 周列表 | 调整预算/分摊/指数 | 本周建议高亮、档位表可视化 |
| 设置 | 分组列表 | 数据备份/币种/重算 | 导入导出 JSON、清空数据 |

### 5.2 共享组件

`src/components/`：
- `AppShell.vue` — 底部 Tab + 顶部栏 + 全局 toast
- `AmountInput.vue` — 金额输入（币种、千分位、整数分存储）
- `DatePicker.vue` — 月份选择器
- `CategoryChip.vue` — 分类标签（可编辑）
- `BarChart.vue` / `PieChart.vue` — Chart.js 包装
- `ConfirmDialog.vue` — 删除/重置确认

### 5.3 Pinia store

| Store | 职责 |
|---|---|
| `useLedgerStore` | 流水 |
| `useBudgetStore` | 预算 |
| `usePortfolioStore` | 持仓 |
| `usePermanentStore` | 永久组合目标 + 偏离计算 |
| `useDcaStore` | 月预算/4 周分摊/指数数据/建议 |
| `useSettingsStore` | 币种/汇率/数据源/最后同步 |

每个 store 只管"内存状态 + 触发 IndexedDB 持久化方法"，不直接操作 DOM。

## 6. 数据模型

数据库 `func-db` v1，10 个 object store。

### 6.1 流水
```
Transaction {
  id, date: 'YYYY-MM-DD',
  type: 'income'|'expense',
  amount: number,  // 分（整数）存储
  categoryId, note?, createdAt, updatedAt, deletedAt?
}
Category { id, name, type: 'income'|'expense'|'both', color, icon }
```

### 6.2 预算
```
BudgetPlan {
  id, month: 'YYYY-MM', totalIncome,
  allocations: [{ categoryId, amount, note? }],
  notes?
}
```

### 6.3 持仓
```
Holding {
  id, symbol, name,
  type: 'stock'|'etf'|'crypto'|'bond'|'cash'|'gold',
  market: 'CN'|'US'|'HK', currency: 'CNY'|'USD',
  quantity, avgCost,
  currentPrice?, currentPriceAt?,  // 缓存
  addedAt, notes?, deletedAt?
}
HoldingTxn {  // 买/卖/分红/费用
  id, holdingId, type: 'buy'|'sell'|'dividend'|'fee',
  date, quantity, price, amount, fee, note
}
```

### 6.4 永久组合
```
PermanentTarget {
  id, assetType: 'stock'|'bond'|'cash'|'gold',
  targetPercent  // 经典默认 25/25/25/25
}
```

### 6.5 智能定投
```
DCAConfig {
  id, name, symbol: 'QQQ',  // v1 只支持 QQQ
  monthlyBudget,
  weeklySplits: [w1, w2, w3, w4],
  deviationAlertPercent: 5,
  // 注:档位表"基础额"= weeklySplits[weekIndex-1],不需独立字段
  // (图 2 的 200 元/期仅为示例)
  createdAt, updatedAt
}
IndexData {
  symbol, date, close, ma250,
  source: 'stooq'|'manual'|'cache'
}
DCAExecution {
  id, configId, weekIndex: 1-4,
  plannedAmount, suggestedByTable,
  deviationPercent, tableBucket,
  executedAt, note
}
```

### 6.6 设置与元信息
```
Settings {
  id: 'app' (单例),
  baseCurrency: 'CNY',
  usdCnyRate, rateUpdatedAt,
  lastIndexSync: { qqq? },
  schemaVersion: 1
}
Meta { key, value }  // lastBackup / migrations
```

### 6.7 关键设计决策
- **金额一律存"分"**（整数）—— 避免 JS 浮点
- **`updatedAt` 时间戳**（ms）—— 同步/冲突解决
- **索引**：按月、按持仓、按日期
- **JSON 备份/导入** 整库序列化（含 schemaVersion，导入时跑迁移）
- **软删除**：`deletedAt`，避免误删

## 7. 数据流

### 7.1 通用读写流

```
UI 触发 action
  → Pinia store 改内存
  → store 调 repo 方法 (xxxRepo.ts)
  → repo 调 IndexedDB (idb 包装)
  → 完成 → 触发 reactive 视图更新
```

`repo` 层是"瘦"封装：方法命名统一 `list/get/put/delete/softDelete`。store 不直接 `indexedDB.open()`。

### 7.2 智能定投计算流

```
打开 /dca
  → useDcaStore.loadActiveConfig()
    ├─ 读 DCAConfig
    └─ 读最近 IndexData (QQQ 最新 close + ma250)
  → 若 lastIndexSync > 1h 或无数据
    └─ 后台 fetch stooq.com CSV (250 天)
       成功 → 写 IndexedDB + 计算 ma250
       失败 → 用缓存 + UI 显示"⚠️ 数据陈旧"
  → computeWeekSuggestion(config, indexData, weekIndex)
    1. currentSplit = config.weeklySplits[weekIndex - 1]
    2. deviation = (close - ma250) / ma250
    3. bucket = lookupBucket(deviation)
    4. relativeRate = bucket.rate
    5. suggested = currentSplit × relativeRate
    6. if suggested > currentSplit: warning = true
  → UI 渲染：本周建议高亮 + 档位表着色 + 偏离条
```

**档位查表**（纯函数，**闭-开区间 `[低, 高)`**，上界归下一档）：

```
偏离 < 0 (低位, 倍投):
  偏离 ∈ [-40, -∞)  → 280%   (即 deviation ≤ -40)
  偏离 ∈ [-30, -40)  → 250%
  偏离 ∈ [-20, -30)  → 220%
  偏离 ∈ [-10, -20)  → 190%
  偏离 ∈ [-5, -10)   → 160%
  偏离 ∈ [0, -5)     → 130%   (即 -5 < deviation ≤ 0)

偏离 = 0 (基准):
  偏离 = 0           → 100%

偏离 > 0 (高位, 少投):
  偏离 ∈ (0, 15)     → 70%    (即 0 < deviation < 15)
  偏离 ∈ [15, 50)    → 40%
  偏离 ∈ [50, 100)   → 10%
  偏离 ∈ [100, +∞)   → 0%
```

**边界约定**：用闭-开区间 `[低, 高)`，上界归下一档。例：
- deviation = -5  → 160% (归下一档，不归 130%)
- deviation = 15   → 40%  (归下一档，不归 70%)
- deviation = 100  → 0%   (归下一档，不归 10%)
- deviation = 0    → 100% (基准)

**与原图 2 表的差异**：原图 2 的 0%-15%(含) 和 15%-50%(含) 同时含 15%，存在二义性。本设计显式选"上界归下一档"（闭-开区间），并将 0% 单独作为基准 100%，避免 `0% < deviation < ε` 落入 70% 的问题。这一约定需在 `lookupBucket` 单测中以 `deviation = -5, 0, 15, 100` 4 个边界 case 验证。

### 7.3 持仓当前价刷新流

```
打开 /portfolio 或下拉刷新
  → 对每只持仓并行 fetch
    ├─ A 股: 东方财富 push2.eastmoney.com/api/qt/stock/get
    │        注意: 该接口在浏览器直连存在 CORS 风险
    │        失败 → 静默回退手填,UI 不报错,只标"数据陈旧"
    ├─ 美股 QQQ: stooq CSV（同 DCA, 无 CORS 问题）
    └─ 其他: 失败手填
  → 成功 → updateHolding(id, { currentPrice, currentPriceAt })
  → 重算 P/L = (currentPrice - avgCost) × quantity
  → UI 更新（按 type 分组）
```

### 7.4 永久组合偏离流

```
打开 /permanent
  → usePermanentStore.compute()
    1. 按 Holding.type 聚合: Σ marketValue
    2. 读 PermanentTarget
    3. 对每类: actualPct = marketValue[assetType] / total
               deviation = actualPct - targetPct
    4. 标记超阈值（默认 ±5%）
  → UI: 4 列对比条 + 偏离条 + 再平衡建议
    "卖出股票 ¥X 买入黄金 ¥Y"
```

### 7.5 备份/恢复流

```
导出:
  1. 读所有 store 全部数据
  2. { schemaVersion, exportedAt, data: { ... } }
  3. JSON.stringify → Blob → 下载 func-backup-YYYYMMDD-HHmm.json

导入:
  1. FileReader 读文件
  2. JSON.parse + validateBackup()
  3. schemaVersion 不匹配 → 跑迁移
  4. 二次确认"将覆盖当前数据"
  5. 单 transaction 写所有 store
  6. 重载页面
```

## 8. 错误处理

### 8.1 网络层
- stooq 失败：toast「自动拉取失败，请手填」+ 数据标"陈旧"
- 拉取间隔 < 1h：跳过用缓存
- 离线：service worker 兜底，API 失败正常处理
- 美股盘中/节假日：stooq 1 天延迟，UI 注明"昨收"
- 东方财富 A 股接口 CORS 失败：**静默回退手填**（不弹错误），只在该持仓卡片上标"价格未更新"+ 提供"手动刷新"按钮

### 8.2 存储层
- 配额满：toast + 跳设置
- 事务失败：idb 自动回滚 + toast
- 首次/升级：`onupgradeneeded` 建/改 store
- IndexedDB 不可用：启动页红横幅

### 8.3 数据迁移
- 旧 schemaVersion：自动 v1→v2 转换
- 新 schemaVersion：拒绝 + 提示
- 字段缺失/类型错：validateBackup 逐项列出
- 导入中断：事务回滚

### 8.4 用户输入
- 金额 ≤ 0：红框 + 不允许保存
- 必填空：按钮 disabled
- 日期超界：软警告
- 删除：ConfirmDialog + 影响范围
- 软删除 30 天：v1 不自动清理，可恢复

### 8.5 智能定投相关
- 指数缺失：禁用"计算建议"按钮
- 偏离 = 0：100% 基准，不警告
- 月预算未设：跳编辑页
- weeklySplits 之和 ≠ monthlyBudget：提示差异
- 档位表超周分扣：黄色高亮 + 文字"按哪个？"
- QQQ 休市：沿用昨收，UI 标"昨收"

### 8.6 全局
- 永不静默失败：catch → console.error + UI 反馈
- 错误集中：`@/lib/errorBus` 统一处理
- 关键操作可恢复：5 秒撤销 toast

## 9. 测试

### 9.1 单元测试（必做）

| # | 函数 | 关键 case | 文件 |
|---|---|---|---|
| 1 | `lookupBucket(deviationPct)` | 边界值覆盖 | `dca/table.test.ts` |
| 2 | `computeWeekSuggestion` | 偏离 0/负/正；超限警告 | `dca/compute.test.ts` |
| 3 | `computeMA250(closes[])` | 不足 250 / 正好 / 含 null | `index/ma.test.ts` |
| 4 | `computeDeviation` | close=ma → 0；2×ma → +100% | `index/deviation.test.ts` |
| 5 | `computePnL(holding)` | 盈利/亏损/持平；多币种 | `portfolio/pnl.test.ts` |
| 6 | `aggregateByType(holdings)` | 4 类合计；空类 → 0% | `permanent/aggregate.test.ts` |
| 7 | `computePermanentDeviation` | 偏离超阈值；总市值 0 边界 | `permanent/deviation.test.ts` |
| 8 | `convertCurrency` | 同币种/反算/rate=0 | `currency/convert.test.ts` |
| 9 | `validateBackup` | 缺字段/错类型/错版本 | `backup/validate.test.ts` |
| 10 | serialize/deserialize | round-trip 一致 | `backup/roundtrip.test.ts` |

### 9.2 组件测试
- `AmountInput` — 0/负数/超长/千分位
- `DcaSuggestionCard` — 档位表 + 偏离条 + 超限
- `ConfirmDialog` — 确认/取消回调
- `BarChart` / `PieChart` — 空/单条/正常

### 9.3 集成测试
- 完整链路：流水 → 预算 → 持仓 → 永久组合
- 备份 → 恢复 → 数据完整
- QQQ 拉取失败 → 手填 → 计算
- A 股拉取 → P/L 变化

### 9.4 手动手机测试清单

```
□ iOS Safari 打开 → "添加到主屏" → PWA
□ Android Chrome 同上
□ 飞行模式 → 缓存数据可见
□ 流水新增/编辑/删除流畅
□ 智能定投：4 周分摊 → 拉 QQQ → 建议合理
□ 永久组合：加 A 股+美股 → 偏离正确
□ 备份导出 JSON 结构正确
□ 备份导入恢复
□ 横竖屏切换不丢数据
□ 杀掉后台重开数据还在
```

### 9.5 覆盖率
- 核心算法：100% 行
- 组件：关键交互 80%+
- 总体：≥ 70%

### 9.6 不引入
- Playwright/Cypress（个人单用户，手测即可）
- CI（本地 `npm test`）

## 10. 部署

### 10.1 本地开发
```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 跑单测
npm run build        # 产出 dist/
npx serve dist       # 电脑当服务,手机同 wifi 访问电脑 IP
```

### 10.2 正式部署（GitHub Pages）
```bash
npm run build
git add dist && git commit -m "build: dist"
# 方案 1: 直接推 gh-pages 分支
git subtree push --prefix dist origin gh-pages
# 方案 2: GitHub Actions 自动构建 (推荐)
```

GitHub Actions 方案：`.github/workflows/deploy.yml`，push main → 自动 build → deploy 到 Pages。

### 10.3 手机使用
1. 手机浏览器打开 `https://用户名.github.io/repo`
2. 浏览器菜单 → "添加到主屏"
3. 像 App 一样启动
4. 数据写入手机 IndexedDB，永远不上传

## 11. 目录结构

```
func/
├─ index.html
├─ vite.config.ts
├─ package.json
├─ tsconfig.json
├─ public/
│  ├─ manifest.webmanifest (PWA)
│  ├─ icon-192.png, icon-512.png
│  └─ apple-touch-icon.png
├─ src/
│  ├─ main.ts
│  ├─ App.vue
│  ├─ router/
│  ├─ stores/  (5+1 Pinia)
│  ├─ repos/   (IndexedDB 封装)
│  ├─ pages/   (6 路由)
│  ├─ components/  (共享组件)
│  ├─ lib/     (工具: 档位表/MA/PnL/汇率/错误总线)
│  ├─ api/     (stooq/东财 拉取)
│  └─ types/
├─ tests/
│  ├─ unit/    (Vitest)
│  └─ setup.ts
├─ docs/superpowers/specs/
│  └─ 2026-08-12-local-personal-finance-pwa-design.md (本文)
└─ openspec/   (OpenSpec 变更)
   └─ changes/<change-name>/
      ├─ proposal.md
      ├─ design.md
      ├─ tasks.md
      └─ specs/<capability>/spec.md
```

## 12. 未来考虑（v1 不做）

- 多账户（v1 单账户）
- 多币种完整支持（v1 仅 CNY + USD）
- 加密货币实时数据
- PIN 码 / 生物识别
- 推送通知（每周定投提醒）
- Web 端深色模式
- 多设备同步（端到端加密）
- 投资策略回测模拟器
- 微信小程序版本

## 13. 开放问题

无 — 所有关键决策已在 6 节设计中与用户对齐。
