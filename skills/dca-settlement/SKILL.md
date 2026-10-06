---
name: dca-settlement
description: 定投(DCA)模拟引擎与周期结算算法：扣款规则、份额累计、收益计算
globs:
  - src/lib/settlement.ts
  - src/stores/dailyDca.ts
  - tests/unit/dca-sim-matrix.test.ts
alwaysApply: false
---

# 定投与结算（L2 核心知识）

## DCA 模拟引擎

- 入口：`src/lib/settlement.ts#runDcaSim`
- 输入：定投计划（周期/金额/基金代码）+ 历史净值序列
- 输出：每期扣款记录、累计份额、市值曲线、收益率

## 结算规则

1. 扣款日遇非交易日 → 顺延到下一交易日
2. 扣款价 = 当日净值（若无则前一交易日）
3. 份额 = 金额 / 净值，保留 2 位（四舍五入）
4. 收益率 = (当前市值 − 累计投入) / 累计投入

## 代码地图

- 周线状态一键拉取 → `src/pages/Portfolio.vue`（20/30/60 周线位置）
- DCA 矩阵测试 → `tests/unit/dca-sim-matrix.test.ts`
- 周期结算细节 → [references/settlement-rules.md](./references/settlement-rules.md)

## 反向校验锚点

- `src/lib/settlement.ts`
- `src/stores/dailyDca.ts`
- `tests/unit/dca-sim-matrix.test.ts`
