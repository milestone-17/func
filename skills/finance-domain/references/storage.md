# 本地存储结构（IndexedDB / idb）

## Store 列表

| Store | 键 | 内容 |
|-------|-----|------|
| transactions | auto | 交易流水 |
| holdings | code | 持仓快照（rebuildLedger 产出） |
| dca-plans | id | 定投计划 |
| watchlist | code | 自选基金 |
| settings | key | 偏好设置 |

## 同步策略

- 本地优先（offline-first），后台与服务器账本对账走 `src/lib/ledger-sync.ts`
- 冲突解决：以 updatedAt 新者为准
