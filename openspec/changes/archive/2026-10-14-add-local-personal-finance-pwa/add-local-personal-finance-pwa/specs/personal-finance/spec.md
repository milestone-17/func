# Spec: personal-finance

## Purpose

本地优先的个人财务 PWA,5 大功能(流水/预算/持仓/永久组合/智能定投),数据存手机 IndexedDB,部署到 GitHub Pages 供手机 PWA 安装。

## Requirements

### ADDED Requirements

#### Ledger (流水)

##### Requirement: 流水记录
系统 SHALL 提供按日记录的流水(花销/收入)CRUD,每条含日期、类型、金额(分)、分类、备注。

##### Requirement: 流水按月查询
系统 SHALL 支持按月份查询流水,自动排除已软删除项。

##### Requirement: 流水软删除
系统 SHALL 通过 `deletedAt` 字段实现软删除,不物理删除任何流水。

##### Requirement: 分类管理
系统 SHALL 提供分类(Category)的增删改查,分类可标记为收入/支出/两者。

#### Budget (月预算)

##### Requirement: 月预算方案
系统 SHALL 支持按月创建预算方案,含总收入和分类分配列表。

##### Requirement: 预算未分配提示
系统 SHALL 计算 `totalIncome - sum(allocations)` 作为"未分配"金额,展示给用户。

##### Requirement: 预算 vs 实际对比
系统 SHALL 按分类聚合当月支出,与预算分配对比展示。

#### Portfolio (持仓)

##### Requirement: 持仓记录
系统 SHALL 支持添加持仓,字段含 symbol/name/type/market/currency/quantity/avgCost。

##### Requirement: 当前价缓存
系统 SHALL 缓存每只持仓的当前价和更新时间(`currentPrice`, `currentPriceAt`)。

##### Requirement: PnL 计算
系统 SHALL 计算每只持仓的未实现盈亏(分)和盈亏百分比,totalCost = avgCost × quantity, unrealized = (currentPrice - avgCost) × quantity。

##### Requirement: 多币种
系统 SHALL 支持 CNY + USD 持仓,聚合总市值时按 USD/CNY 汇率换算。

##### Requirement: QQQ 历史价自动拉取
系统 SHALL 通过 stooq.com 拉取 QQQ 250 日历史价,计算 MA250。

##### Requirement: A 股价格拉取 (best-effort)
系统 SHALL 尝试通过东方财富 push2 接口拉取 A 股当前价;CORS 失败 SHALL 静默回退,UI 标记"价格未更新",不报错。

##### Requirement: 价格刷新 1 小时缓存
系统 SHALL 缓存指数拉取结果,1 小时内不重复拉取;用户可强制刷新。

#### Permanent Portfolio (永久组合)

##### Requirement: 经典 25/25/25/25 默认
系统 SHALL 首次使用时自动初始化永久组合目标为 stock 25% / bond 25% / cash 25% / gold 25%。

##### Requirement: 按类型聚合市值
系统 SHALL 将所有 holding 按 type 聚合: stock/etf → 股票,bond → 债券,cash → 现金,gold → 黄金。

##### Requirement: 偏离计算
系统 SHALL 计算每类资产 `actualPct - targetPct`,以百分点为单位。

##### Requirement: 偏离阈值告警
系统 SHALL 标记 `|deviation| > 5%` 的资产为 alert,UI 标红并给出再平衡建议(哪类需卖出/买入)。

##### Requirement: 阈值可配
系统 SHALL 允许用户自定义偏离阈值(默认 5%)。

#### Smart DCA (智能定投)

##### Requirement: 月预算 4 周分摊
系统 SHALL 支持用户在 DCAConfig 中设置 `monthlyBudget` 和 `weeklySplits: [w1, w2, w3, w4]`,每周可不同。

##### Requirement: 250 日均线
系统 SHALL 以 250 日均线(MA250)为估值锚点,数据从 stooq.com 拉取。

##### Requirement: 档位表查表
系统 SHALL 实现 `lookupBucket(deviationPct)`,使用闭-开区间,边界约定: 偏离 = -5 → 160%, 偏离 = 0 → 100%, 偏离 = 15 → 40%, 偏离 = 100 → 0%。

##### Requirement: 周建议金额
系统 SHALL 计算 `currentSplit × relativeRate`,作为当周建议扣款金额,`currentSplit = weeklySplits[weekIndex-1]`。

##### Requirement: 超限提醒
WHEN 当周建议 > 当周分扣,SYSTEM SHALL 黄色高亮并提示"按哪个?你决定",不强制覆盖用户设置。

##### Requirement: QQQ 单标的
v1 SHALL 只支持 QQQ 一个标的的智能定投。

##### Requirement: 手动指数输入
系统 SHALL 允许用户手动输入当前价和 MA250,作为自动拉取的回退。

##### Requirement: 指数同步状态
系统 SHALL 显示最后同步时间,失败时显示错误信息并使用缓存数据。

#### Settings & Backup

##### Requirement: 美元人民币汇率
系统 SHALL 维护 USD/CNY 汇率(手动设置,v1 不自动拉取),用于多币种换算。

##### Requirement: 备份导出
系统 SHALL 支持导出所有 IndexedDB 数据为 JSON 文件,文件名含时间戳,内容含 schemaVersion + exportedAt + 10 个 store 的全部数据。

##### Requirement: 备份导入
系统 SHALL 支持从 JSON 文件导入,导入前 SHALL 验证 schemaVersion 和所有 store 存在。

##### Requirement: 二次确认
系统 SHALL 在覆盖现有数据前弹出 ConfirmDialog 二次确认。

##### Requirement: 全部清空
系统 SHALL 提供"清空所有数据"功能,需二次确认。

#### Architecture

##### Requirement: 离线优先
系统 SHALL 设计为离线优先,所有核心功能(除自动拉取)在无网时仍可用。

##### Requirement: 软删除统一
系统 SHALL 所有数据 store 统一使用 `deletedAt` 字段做软删除。

##### Requirement: 金额整数存储
系统 SHALL 所有金额字段以"分"为单位存整数,UI 显示时除以 100 并本地化格式化。

##### Requirement: 中文界面
v1 SHALL 仅提供中文界面,文档/注释中文。

##### Requirement: 手机优先
系统 SHALL UI 优先手机视口,桌面端可访问但不做专门适配。

#### Testing

##### Requirement: 核心算法 100% 行覆盖
系统 SHALL 核心算法(`lookupBucket`, `computeMA250`, `computeDeviation`, `computeWeekSuggestion`, `computePnL`, `computePermanentDeviation`, `convertCurrency`, `serialize/validateBackup`)单测 100% 行覆盖。

##### Requirement: 单元测试用 Vitest
系统 SHALL 使用 Vitest + happy-dom + fake-indexeddb 跑测试,`npm test` 5 秒内出结果。

##### Requirement: 总体覆盖率 ≥ 70%
系统 SHALL 总体行覆盖率 ≥ 70%。

##### Requirement: 手机手测清单
部署到 GitHub Pages 后 SHALL 按 spec §9.4 清单跑 iOS Safari / Android Chrome PWA 安装、离线、流水 CRUD、定投建议、永久组合、备份导入导出、横竖屏、杀后台重开等手测。

#### Deployment

##### Requirement: GitHub Pages 部署
系统 SHALL 通过 GitHub Actions 自动部署到 GitHub Pages,workflow 跑 `npm ci && npm test && npm run build` 后上传 dist/ 到 Pages。

##### Requirement: PWA 可安装
系统 SHALL 通过 vite-plugin-pwa 生成 manifest + service worker,手机浏览器可"添加到主屏"。

##### Requirement: base path
vite.config.ts SHALL 设置 `base: '/func/'`,匹配 GitHub Pages 子路径。
