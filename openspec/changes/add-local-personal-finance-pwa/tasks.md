# Tasks: add-local-personal-finance-pwa

> 完整 26-task 实施计划含代码、测试、命令,见 `docs/superpowers/plans/2026-08-12-local-personal-finance-pwa.md`。本文件是 OpenSpec 用的精简版任务清单,用于追踪完成度。

## 1. 脚手架与基础设施

- [ ] 1.1 初始化 Vite + Vue 3 + TS + Vitest 项目骨架
- [ ] 1.2 配置 vite-plugin-pwa,manifest 完整字段,workbox 缓存策略
- [ ] 1.3 IndexedDB 数据库 `func-db` v1,11 个 object store 全部建立
- [ ] 1.4 全局 `money.ts` 工具(yuanToFen/fenToYuan/formatYuan/roundYuanToFen)

## 2. 核心算法 TDD (Phase 2)

- [ ] 2.1 `table.ts` lookupBucket 10 档位,边界 16 个 case 单测全过
- [ ] 2.2 `ma.ts` computeMA250 + `deviation.ts` computeDeviation
- [ ] 2.3 `dca.ts` computeWeekSuggestion(基础额 = 当周分扣,超限警告)
- [ ] 2.4 `pnl.ts` computePnL(null currentPrice 边界)
- [ ] 2.5 `permanent.ts` aggregateByType + computePermanentDeviation
- [ ] 2.6 `currency.ts` convertCurrency(CNY↔USD,rate 校验)

## 3. 备份与外部数据源 (Phase 3)

- [ ] 3.1 `backup.ts` serialize/validateBackup/parseBackup + 10 个 round-trip test
- [ ] 3.2 `stooq.ts` fetchQQQHistory + `csv.ts` parseStooqCsv

## 4. 仓储层 (Phase 4)

- [ ] 4.1 transactionRepo + categoryRepo + budgetRepo (流水 + 预算)
- [ ] 4.2 holdingRepo + holdingTxnRepo + permanentTargetRepo (持仓 + 永久)
- [ ] 4.3 dcaConfigRepo + indexDataRepo + dcaExecutionRepo + settingsRepo + metaRepo

## 5. Pinia 状态管理 (Phase 5)

- [ ] 5.1 settingsStore + ledgerStore
- [ ] 5.2 budgetStore + portfolioStore (含多币种换算)
- [ ] 5.3 permanentStore + dcaStore (含 stooq 同步逻辑)

## 6. 共享组件 (Phase 6)

- [ ] 6.1 AmountInput + ConfirmDialog + DatePicker
- [ ] 6.2 AppShell (底部 Tab) + BarChart + PieChart + DcaSuggestionCard + CategoryChip

## 7. 页面 (Phase 7)

- [ ] 7.1 Dashboard + Ledger 页
- [ ] 7.2 Budget + Portfolio 页 (含 Eastmoney 静默回退)
- [ ] 7.3 Permanent + DCA 页 (DCA 含 form 回填)
- [ ] 7.4 Settings 页 (含 JSON 备份导入导出 + 二次确认 + 清空)

## 8. 最终装配 (Phase 8)

- [ ] 8.1 Router 装配,6 路由 + 重定向
- [ ] 8.2 PWA 配置完成 (manifest + icons + service worker)
- [ ] 8.3 GitHub Actions deploy workflow + README

## 9. 验收

- [ ] 9.1 `npm test` 全套通过,核心算法 100% 行覆盖,总体 ≥ 70%
- [ ] 9.2 `npm run build` 无 TS 错误
- [ ] 9.3 部署到 GitHub Pages 后,按 spec §9.4 跑手机手测清单(11 项)
