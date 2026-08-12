# 本地个人财务 PWA

本地优先的个人财务工具,数据永远在手机 IndexedDB。

## 功能

1. 流水 (花销/收入)
2. 月预算分配
3. 持仓与股票收益
4. 永久组合建议 (Harry Browne 25/25/25/25)
5. 智能定投 (纳指 100, 基于 250 日均线 + 档位表)

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 跑测试
npm run build      # 产出 dist/
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
- OpenSpec: `openspec/changes/add-local-personal-finance-pwa/`
