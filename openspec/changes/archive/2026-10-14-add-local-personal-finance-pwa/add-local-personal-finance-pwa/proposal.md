# Change: 本地个人财务 PWA

## Why

用户需要一个在手机上使用的本地优先个人财务工具,覆盖 5 项核心功能:

1. 日常花销与收入记录(流水)
2. 每月收入预算分配
3. 股票持仓与收益记录
4. 永久投资组合(Harry Browne 25/25/25/25)偏离建议
5. 纳斯达克 100 智能定投(基于 250 日均线 + 档位表)

## What Changes

- 新增 Vue 3 + Vite + TypeScript PWA 项目 `func/`
- 5 个功能模块(流水 / 预算 / 持仓 / 永久组合 / 智能定投)+ 1 个设置页
- IndexedDB 10 个 object store,所有数据本地存储
- 智能定投算法: MA250 + 闭-开区间档位表查表 + 超限提醒
- 永久组合: 经典 25/25/25/25,偏离阈值 5% 触发再平衡提醒
- 部署: GitHub Pages → 手机浏览器"添加到主屏"安装 PWA
- 数据永不离开设备,备份/恢复通过 JSON 导入导出

## Impact

- 新增项目: `package.json`, `vite.config.ts`, `src/`, `tests/`, `.github/workflows/`
- 文档: `docs/superpowers/specs/2026-08-12-local-personal-finance-pwa-design.md`(详细设计)
- 计划: `docs/superpowers/plans/2026-08-12-local-personal-finance-pwa.md`(26 task 实施计划)
- 不影响其他模块(全新项目,无既有代码)

## Non-Goals

- 多设备同步 / 多用户
- 银行/券商自动对接
- 加密货币实时链上数据
- 税务计算
- 通知推送 (v1)
- i18n (仅中文)
- PIN / 生物识别 (本地数据已足够)
- 深色模式 (v1 跟随系统)
- ESLint / Prettier / CI (个人项目降本)

## Risk

- 东方财富 A 股接口在浏览器直连有 CORS 风险 → 静默回退手填(已在 spec §8.1 明确)
- stooq.com 接口稳定性 → 1 小时缓存 + 失败用旧数据 + UI 标"陈旧"
- GitHub Pages base path 配置错误会导致手机 404 → vite.config.ts `base: '/func/'` + 测试覆盖
- IndexedDB 跨浏览器行为差异 → fake-indexeddb 测本地逻辑,真机手测清单已列(spec §9.4)
