# 名词对象表（T-xx 编号，与 Prisma 模型/核心概念一一对应）

> 术语唯一来源：`server/prisma/schema.prisma`。新模型必须先在这里登记再写代码（校验器会对照）。

## T-User — 用户
- Prisma: `User`。uuid 主键，email 唯一。管理端另有 role/disabled 字段。

## T-Transaction — 交易流水
- Prisma: `Transaction`。用户所有收支记录的源头（不只投资），分类/预算体系的数据基础。

## T-Holding — 持仓
- Prisma: `Holding`。当前持有份额/成本，由交易推导并守护（C-01）。

## T-HoldingTxn — 持仓交易
- Prisma: `HoldingTxn`。持仓维度的买卖明细，账本同步（ledger-sync）的输入。

## T-DcaConfig — 定投配置
- Prisma: `DcaConfig`。周期定投计划（金额/频率/目标基金），id 按用户隔离（C-03）。

## T-DcaExecution — 定投执行
- Prisma: `DcaExecution`。一次定投扣款的执行记录，失败也留痕。

## T-DailyDcaConfig — 每日定投配置
- Prisma: `DailyDcaConfig`。日频定投特化配置，同样按用户隔离（C-03）。

## T-DcaFund — 定投基金池
- Prisma: `DcaFund`。定投可选的目标基金池（基金代码/名称白名单）。

## T-ValuationSnapshot — 估值快照
- Prisma: `ValuationSnapshot`。每日估值/温度计数据，来源见 C-05。

## T-FundNavHistory — 基金净值历史
- Prisma: `FundNavHistory`。场外基金净值序列，K 线与结算的数据源。

## T-IndexData — 指数数据
- Prisma: `IndexData`。指数行情（沪深300/纳指100 等），口径约束 C-05。

## T-PermanentTarget — 永久组合目标
- Prisma: `PermanentTarget`。资产配置的目标比例，再平衡参照。

## T-AppSetting — 应用设置
- Prisma: `AppSetting`。KV 型全局设置。

## T-AdminAudit — 管理审计
- Prisma: `AdminAudit`。管理后台敏感操作留痕（panel API 全部写入）。

## T-NotificationConfig / T-NotificationLog — 通知配置/日志
- Prisma: `NotificationConfig` / `NotificationLog`。通知渠道配置与发送记录（走 C-09 的 mailer）。

## T-SettleDay — 结算日（概念，无模型）
- 前端 `src/lib/settlement.ts` 的结算日历概念：T+N 确认日，`isSettled` 判断、`suggestSettleDays` 建议值。结算执行在前端（C-08）。

## T-Panel — 管理面板（概念）
- `/api/admin/panel/*` 路由族 + `_admin/` 前端，受 `requirePanel` 守卫；所有写操作记 T-AdminAudit。
