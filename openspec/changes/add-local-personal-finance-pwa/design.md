# Design: 本地个人财务 PWA

> 完整设计见 `docs/superpowers/specs/2026-08-12-local-personal-finance-pwa-design.md`。本文是 OpenSpec 用的精简版。

## 架构

```
手机浏览器/PWA (Vue 3 SPA)
  ├─ 路由: 6 路由 (5 模块 + 设置)
  ├─ 状态: Pinia (6 store)
  ├─ 存储: IndexedDB (10 object store, via idb)
  └─ 缓存: Workbox (PWA service worker)
        ↓ HTTPS
GitHub Pages (静态资源) + stooq.com (QQQ/NDX 历史价)
```

## 技术栈

- **Vue 3.4** (`<script setup>`) + **Vite 5** + **TypeScript 5**
- **Pinia 2** + **vue-router 4** + **idb 8**
- **Chart.js 4** + **vue-chartjs 5**
- **Vitest 1.x** + **happy-dom** + **fake-indexeddb**
- **vite-plugin-pwa** (Workbox)

## 模块

| 路由 | 模块 | 职责 |
|---|---|---|
| `/dashboard` | 概览 | 今日/本月流水 + 本周定投建议 |
| `/ledger` | 流水 | 月历 + 当日明细 + 记一笔 |
| `/budget` | 预算 | 月预算仪表盘 + 分配调整 |
| `/portfolio` | 持仓 | 持仓列表 + 总收益 + 价格刷新 |
| `/permanent` | 永久组合 | 4 类资产饼图 + 偏离条 + 再平衡建议 |
| `/dca` | 智能定投 | 本月定投面板 + 4 周建议 + 档位表 |
| `/settings` | 设置 | 币种/汇率/数据导入导出 |

手机导航: 底部 Tab(流水 → 定投 → 永久 → 持仓 → 预算),设置右上角齿轮。

## 数据模型 (IndexedDB `func-db` v1)

10 个 object store:
- `transactions` - 流水(金额存"分"整数)
- `categories` - 分类
- `budgets` - 月预算方案
- `holdings` - 持仓
- `holdingTxns` - 持仓交易
- `permanentTargets` - 永久组合目标(v1 经典 25/25/25/25)
- `dcaConfigs` - 智能定投配置
- `indexData` - 指数数据(symbol+date 复合主键)
- `dcaExecutions` - 每周定投执行记录
- `settings` - 应用设置(单例 id='app')
- `meta` - 元信息(lastBackup / migrations)

软删除: 所有 store 加 `deletedAt` 字段,不物理删除。

## 关键算法

### 智能定投档位表(纯函数 `lookupBucket(deviationPct)`)

闭-开区间 `[低, 高)`,上界归下一档:

```
偏离 < 0 (低位, 倍投):
  x ≤ -40           → 280%
  -40 < x ≤ -30     → 250%
  -30 < x ≤ -20     → 220%
  -20 < x ≤ -10     → 190%
  -10 < x ≤ -5      → 160%
  -5 < x ≤ 0        → 130%
偏离 = 0 (基准):     → 100%
偏离 > 0 (高位, 少投):
  0 < x < 15        → 70%
  15 ≤ x < 50       → 40%
  50 ≤ x < 100      → 10%
  x ≥ 100           → 0%
```

边界约定: 偏离 = -5 → 160% (归下一档,不归 130%)。需在单测中以 deviation = -5, 0, 15, 100 验证。

### 计算流

```
当周建议 = weeklySplits[weekIndex-1] × lookupBucket(deviation) 的 rate
若 建议 > weeklySplits[weekIndex-1] → 黄色高亮 + 文字"按哪个?你决定"
```

## 数据流

- 通用: UI → Pinia store → repo (idb 包装) → IndexedDB
- 智能定投: 打开 /dca → 1h 缓存过期则拉 stooq CSV → 写 indexData → 算 MA250 → computeWeekSuggestion × 4
- 持仓价格: 拉取(stooq 美股 / 东方财富 A 股,失败静默)→ updatePrice → 重算 PnL
- 永久组合: 聚合所有 holding 按 type → 算 actualPct → 与 targetPct 对比 → 偏离 > 5% 标红 + 再平衡建议
- 备份: 读全部 store → serialize (schemaVersion + exportedAt) → 下载 JSON
- 恢复: validateBackup → 单 transaction 写所有 store → 重载

## 错误处理

- 网络失败: toast + 数据标"陈旧",不阻塞
- 配额满: 跳设置页导出清理
- 事务失败: idb 自动回滚 + toast
- 备份版本不匹配: 自动迁移 / 拒绝
- 输入校验: 金额 ≤ 0 红框 + 不保存
- 删除: ConfirmDialog 二次确认
- 智能定投无指数: 禁用"计算建议"按钮

## 部署

- 本地: `npm run dev` / `npm run build` / `npx serve dist`
- 正式: GitHub Actions → `npm ci && npm test && npm run build` → `actions/upload-pages-artifact` → `actions/deploy-pages`
- URL 形如 `https://<user>.github.io/func/`,vite `base: '/func/'`

## 详细引用

- 完整设计: `docs/superpowers/specs/2026-08-12-local-personal-finance-pwa-design.md`
- 实施计划: `docs/superpowers/plans/2026-08-12-local-personal-finance-pwa.md`
- 端到端验收: spec §9.4 手机手测清单
