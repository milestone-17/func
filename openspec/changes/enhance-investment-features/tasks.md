## 1. 类型与存储基础

- [x] 1.1 `src/types/portfolio.ts`：`Holding` 增 `category: 'nasdaq100'|'sp500'|'bond'|'dividend'|'other'`（默认 other）；导出 `HoldingCategory` 类型
- [x] 1.2 `src/types/dca.ts`：新增 `DailyDcaConfig`（id/enabled/holdingId/dailyAmountFen/lastExecutedDate + 时间戳）
- [x] 1.3 `src/repos/db.ts`：`SCHEMA_VERSION` 1→2；将现有 `upgrade` 全部 store 创建包进 `if (oldVersion < 1)`；新增 `if (oldVersion < 2)` 仅创建 `dailyDcaConfigs` store（带 `objectStoreNames.contains` 守卫）；在 `FuncDB` 接口加 `dailyDcaConfigs`
- [x] 1.4 `src/repos/dcaConfigRepo.ts`：新增 `getBySymbol(symbol)`（读全部按 `symbol` 匹配；NDX 兼容旧 `singleton`）；`saveBySymbol(symbol, cfg)` 用 `id=symbol` 写入；保留旧 `get/save` 供过渡
- [x] 1.5 新增 `src/repos/dailyDcaConfigRepo.ts`：单例 get/save（id='daily'）
- [x] 1.6 `src/repos/holdingRepo.ts`/`holdingTxnRepo.ts`：确认加字段/买入交易无需 schema 改动（仅复核）

## 2. 现价自动拉取与失败安全（投资组合页）

- [x] 2.1 `src/lib/yahoo.ts`：`fetchLiveQuotes(symbol)` 参数化；保留代理链与 ≥250 校验
- [x] 2.2 `src/stores/portfolio.ts`：新增 `refreshAllPrices()`（逐只拉取，失败保留原值并累计失败列表返回）；`updatePrice` 不变
- [x] 2.3 `src/pages/Portfolio.vue`：`onMounted` 自动调 `refreshAllPrices()`；保留「拉取」按钮（改为「拉取全部」）；失败时 Toast/内联提示「部分行情拉取失败，已保留上次数据」
- [x] 2.4 单元测试：`fetchLiveQuotes` 失败返回 null 不抛；`refreshAllPrices` 单只失败不清空其他持仓现价

## 3. 持仓分类标签与按类聚合

- [x] 3.1 `src/stores/portfolio.ts`：`HoldingView` 增 `category`；新增按 category 聚合的 computed（小计市值 CNY、数量）
- [x] 3.2 `src/pages/Portfolio.vue`：顶部分类 Tab（全部/纳斯达克100/标普500/债券/红利）；按 activeCategory 过滤列表 + 显示分类小计
- [x] 3.3 `src/pages/Portfolio.vue`：新建/编辑表单增「分类」选择（选债券→type 默认 bond，选红利/纳斯达克100/标普500→type 默认 stock）
- [x] 3.4 单元测试：分类聚合小计 = 该类持仓本币市值之和；外币按汇率换算后累加

## 4. 永久组合自动驱动

- [x] 4.1 复核 `src/stores/permanent.ts` + `src/lib/permanent.ts`：实际占比确由 `portfolio.holdings` + 自动现价驱动；无手填市值入口
- [x] 4.2 `src/pages/Permanent.vue`：确认随 `portfolio.refresh()`/现价变化自动重算（响应式依赖持仓 store）；文案明确「实际占比自动来自持仓」
- [x] 4.3 单元测试：`computePermanentDeviation` 在有/无现价、超阈值提醒、阈值内不提醒各场景

## 5. 定投：MA180 + 标普500 多标的

- [x] 5.1 `src/lib/ma.ts`：新增通用 `computeMA(closes, period)`（复用 rollingMA 末值）；保留 `computeMA250`
- [x] 5.2 `src/stores/dca.ts`：重构为多 symbol——`states: Record<string, SymbolState>` + `activeSymbol`；每 symbol 独立 config/series/ma120/ma180/ma250/bucket/suggestions；`load()`/`syncIndex(symbol)`/`saveConfig(symbol,cfg)` 参数化；NDX 兼容旧 singleton（D2）
- [x] 5.3 `src/pages/Dca.vue`：顶部标的切换 Tab（纳斯达克100 / 标普500）；行情卡片增 MA180；图表 series 增 MA180 曲线；四周建议按 activeSymbol 取
- [x] 5.4 单元测试：MA180 数据≥180 有值、<180 返回 null；多 symbol 状态独立；档位系数高位<1/低位>1

## 6. 每日定投自动记账

- [x] 6.1 新增 `src/lib/dailyDca.ts`：`shouldExecuteToday(cfg, todayISO)`、`execute(cfg, holding)`（无有效价返回 no-price 不记账；否则写 buy holdingTxn + 更新 lastExecutedDate）
- [x] 6.2 新增 `src/stores/dailyDca.ts`：load config / save / `runIfPending()`（幂等：当日已执行跳过；成功后 portfolio.refresh）
- [x] 6.3 `src/App.vue`：mount 调 `dailyDcaStore.runIfPending()`（一次）
- [x] 6.4 定投页/设置页：每日定投配置入口（选持仓 + 每日金额 + 启停）；展示「最近执行日期」与未执行提示
- [x] 6.5 单元测试：当日首次执行写一笔；同日重复不写；无现价跳过返回 no-price；金额非正不生效

## 7. 构建时打包行情（NDX + GSPC）

- [x] 7.1 `scripts/fetch-nasdaq.cjs`→重命名/扩展为抓 `^NDX` 与 `^GSPC`，写 `public/index-data.json`（`{indices:{'^NDX':{...},'^GSPC':{...}}}` + 兼容旧 `bars`/顶层字段降级）
- [x] 7.2 `src/lib/yahoo.ts`：`loadBundledQuotes(symbol)` 按新结构取，旧结构降级为 NDX
- [x] 7.3 接入构建流程（vite build 前运行抓取脚本，失败保留旧文件不阻断）
- [x] 7.4 验证：`npm run build` 成功；抓取失败时保留旧 json

## 8. 集成验证、测试与文档

- [x] 8.1 `npm run test`（vitest）全绿，覆盖上述各单元测试
- [x] 8.2 `npm run build`（vue-tsc + vite）通过，无 TS 错误
- [x] 8.3 `npm run test:e2e`（Playwright/python）通过；新增用例：分类切换、每日定投幂等、schema 升级后旧数据保留
- [x] 8.4 手动回归：旧版本数据 → 升级 → 历史持仓/定投不丢失；现价拉取失败不清空
- [x] 8.5 更新 README/docs 说明新功能与升级注意事项
