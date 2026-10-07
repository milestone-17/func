---
name: finance-domain
description: func 的基金投资领域模型：用户/账本/持仓/交易流水/基金池，及其核心不变量
globs:
  - src/lib/ledger-sync.ts
  - src/lib/settlement.ts
  - src/stores/**
  - server/prisma/schema.prisma
alwaysApply: false
---

# 基金领域模型（L2 核心知识）

## 核心实体与关系

- **User**：邮箱/游客两种 provider，角色 admin 可进管理后台
- **Transaction（交易流水）**：记账原子单元，`server/prisma/schema.prisma#model Transaction`
- **Holding（持仓）**：由流水聚合推导，不单独记账；前端聚合逻辑在 `src/lib/ledger-sync.ts`
- **FundPool（基金池）**：管理员维护的可交易基金白名单，后台可增删

## 关键不变量

1. 持仓数量 = Σ(买入份额) − Σ(卖出份额)，不允许为负（同步入口 `src/lib/ledger-sync.ts#syncInvestToLedger`）
2. 成本 = Σ(买入金额) − Σ(卖出金额×卖出比例)，摊薄成本法
3. 账本同步必须幂等：同一份流水重放得到相同持仓

## 代码地图（L2→L3 索引）

- 流水 ↔ 持仓同步算法细节 → [references/ledger-sync.md](./references/ledger-sync.md)
- IndexedDB 本地存储结构（idb）→ [references/storage.md](./references/storage.md)

## 反向校验锚点

修改以下文件时必须复核本文档：
- `src/lib/ledger-sync.ts`
- `src/lib/settlement.ts`
- `server/prisma/schema.prisma`（Transaction/Holding 模型字段）

细节文档 `references/ledger-sync.md` 中的流程描述如与代码不符, 以代码为准并回改文档
## 约束关联

本 skill 涉及的不可变约束（详见 [_meta/constraints.md](../_meta/constraints.md)）：C-01, C-02, C-10
术语表：[_meta/glossary.md](../_meta/glossary.md) · 踩坑记录：[_meta/pitfalls.md](../_meta/pitfalls.md)
