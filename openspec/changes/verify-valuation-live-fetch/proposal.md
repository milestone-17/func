---
name: proposal
description: proposal 草案 (已按实拉验证更新根因)
---

# Proposal: verify-valuation-live-fetch

## Why

用户反馈: 浏览器实跑 `/suggest` 点"拉取估值"仍然 16 行全是 "—", toast "拉取失败, 本地也无历史快照"。

上一轮 (`fix-valuation-data-fetch`) 把 fetch 改成 push2 普通 fetch + 数据中心 `RPT_VALUATIONANALYSIS` 报表, 我自认通过但**没有真跑网络**。这次不再猜, 对真实东财 API 逐项 curl 实拉验证, 找到真正根因。

## Root Cause (已实拉确认, 推翻了上一轮"双重编码"的猜测)

双重编码确实存在且已修, 但**不是** 16 行全失败的根因。真正根因是**两个数据源本身就是错的**:

1. **push2 `stock/get` 的 f162/f167 对指数返回 0**
   实拉: `1.000300` → `{"data":{"f43":465988,"f58":"沪深300","f162":0,"f167":0}}`
   → `parseEastmoneySnapshot` 把 0 转 null → 抛 `snapshot-empty`。

2. **`RPT_VALUATIONANALYSIS` 报表根本不存在**
   实拉: `{"success":false,"message":"报表配置不存在,RPT_VALUATIONANALYSIS","code":9501}`
   → 历史序列永远空 → 抛 `history-empty`。

两个失败并行发生 → 16 行全 failReason → 页面全 "—" + toast。

## What Changes (数据源改为实拉验证过的报表)

| 原 | 现 | 验证 |
|---|---|---|
| push2 f162/f167 快照 | **删除** (对指数返回 0) | curl 实拉 |
| `RPT_VALUATIONANALYSIS` 历史 | **删除** (报表不存在 9501) | curl 实拉 |
| — | 指数 `RPT_VALUEMARKET` (`TRADE_MARKET_CODE`, `PE_TTM_AVG`, 500 条/页翻页) | curl 实拉, CORS `*` |
| — | 行业 `RPT_VALUEINDUSTRY_DET` (`BOARD_CODE`, `PE_TTM`/`PB_MRQ`, 一次拿全) | curl 实拉, CORS `*` |

- **标的清单对齐可用数据**: 6 宽基改为 RPT_VALUEMARKET 覆盖的 6 个市场 (上证指数/沪深300/深证成指/创业板指/科创50/北证50); 10 申万一级行业改为其代表性申万三级子行业 (银行Ⅱ/化学制药/半导体…)。中证500/中证1000/上证50 及申万一级粒度在**所有浏览器可 fetch 的东财报表中都不存在** (danjuan 有全量数据但无 CORS 头)。
- **fetch 架构**: 每个标的 1 次主请求 (指数内部翻页最多 5 次), 最新一行 = 当前值, 其余 = 历史序列算分位。不再需要独立快照请求。
- **store**: `fetchAll` 由串行改并行 (指数翻页后串行 40 请求太慢, 并行 ~2s)。
- **实拉结果**: 16/16 标的对真实 API 全部成功, PE/PB/分位均为真数据 (见 design.md 验证表)。

## Acceptance (浏览器 `/suggest` 点"拉取估值")

- 16 行全部有 PE-TTM 数字 (指数无 PB 显示 "—", 报表无 PB 字段)
- 分位列是 0-100 整数
- 至少 2-3 种颜色 badge (绿/蓝/红)
- 搜索能过滤; 切"选型"排序最高估在最上
- 失败时 failReason 不再是 `history-empty`/`snapshot-empty` (即数据真的从东财回来了)

## Out of Scope

- 恢复中证500/中证1000/上证50 / 申万一级粒度 → 需要后端代理 danjuan (无 CORS), 本改动不做
- 改 5 档分级 / 排序逻辑 / 搜索逻辑
