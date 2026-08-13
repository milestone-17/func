# 本地个人财务 PWA

本地优先的个人财务工具,数据永远在手机 IndexedDB。

## 功能

1. 流水 (花销/收入)
2. 月预算分配
3. 持仓与股票收益
   - 现价**自动拉取**（进入页面自动刷新 + 手动「拉取全部」按钮），失败保留上次数据不清空，仍可手动覆盖
   - 资产分类标签（纳斯达克100 / 标普500 / 债券 / 红利 / 其他），按分类聚合查看与小计
4. 永久组合建议 (Harry Browne 25/25/25/25)：实际占比**自动来自持仓**，用户只设目标，自动算偏差与再平衡提醒
5. 智能定投：纳斯达克100 与标普500 双标的，均线偏离策略（MA120 / MA180 / MA250 + 档位表 + 月度4周建议）
   - **每日定投**：选基金设每日金额，打开应用时按最新价自动买入并更新持仓（幂等，浏览器关闭不执行）

## 数据与升级

- 所有数据存浏览器 IndexedDB，刷新 / 关闭重开 / 升级版本均不丢失。
- 数据库 schema 升级采用增量迁移（仅新增 store，不重建已有），历史数据完整保留。
- 行情数据在构建时打包进站点（同源，避免浏览器 CORS），CI 每日自动刷新。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 跑单元测试
npm run build      # 产出 dist/
npm run test:e2e   # 构建 + Playwright 真实浏览器回归
```

## 部署

1. 推到 GitHub
2. Settings → Pages → Source: GitHub Actions
3. 等待 workflow 跑完,访问 `https://<user>.github.io/<repo>/`

## 手机使用

1. 浏览器打开部署 URL
2. 菜单 → 添加到主屏
3. 像 App 一样启动,数据存手机本地

## 文档

- 设计: `docs/superpowers/specs/2026-08-12-local-personal-finance-pwa-design.md`
- 计划: `docs/superpowers/plans/2026-08-12-local-personal-finance-pwa.md`
- OpenSpec: `openspec/changes/add-local-personal-finance-pwa/`、`openspec/changes/enhance-investment-features/`（投资增强：自动拉价/分类/多标的定投/每日定投/升级迁移）
