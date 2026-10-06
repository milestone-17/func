# 账本同步算法（L3 细节）

## rebuildLedger 流程

1. 按时间升序读取全部流水
2. 逐笔更新 `Map<code, {shares, cost}>`
   - 买入：`shares += t.shares; cost += t.amount`
   - 卖出：`ratio = t.shares / holding.shares; cost -= t.amount * ratio`（按比例摊薄成本）
   - 分红再投资：等价买入，金额为再投金额
3. 产出持仓快照，写入 IndexedDB `holdings` store

## 边界情况

- 卖出份额 > 持有份额 → 丢弃该流水并记录告警（数据修复场景）
- 净值缺失的日期 → 沿用前一交易日净值（`server/src/cron/market.ts` 保证历史净值连续）
