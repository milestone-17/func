---
name: kline-chart
description: K 线图实现：canvas 自绘蜡烛图、MA/成交量/周期切换、分时图、缩放平移、复权
globs:
  - src/pages/**
  - src/components/**
alwaysApply: false
---

# K 线图（L2 核心知识）

## 演进记录（对齐天天基金体验）

1. canvas 自绘蜡烛图（不依赖 echarts，包体与性能考虑）
2. MA5/10/20/30 + 成交量副图 + 周期切换（日/周/月）
3. 分时图、缩放平移手势、前复权/后复权切换、沪深300 对比叠加

## 实现要点

- 纯 canvas 2D，devicePixelRatio 适配
- 数据源：`/api/market/kline`（server 代理天天基金）
- 手势：pointer events，双指缩放 + 单指平移

## 代码地图

- 相关提交：`feat(kline)` 系列（见后台版本记录）
- 细节文档 → [references/canvas-notes.md](./references/canvas-notes.md)

## 反向校验锚点

- K 线相关页面在 `src/pages/`（Watchlist/Portfolio/Kline）
- 若引入 echarts 等库需重写本 skill
## 约束关联

本 skill 涉及的不可变约束（详见 [_meta/constraints.md](../_meta/constraints.md)）：C-05
术语表：[_meta/glossary.md](../_meta/glossary.md) · 踩坑记录：[_meta/pitfalls.md](../_meta/pitfalls.md)
