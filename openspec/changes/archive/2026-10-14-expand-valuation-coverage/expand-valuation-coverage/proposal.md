---
name: proposal
description: proposal 草案 (行业扩到 127, 指数保持 6)
---

# Proposal: expand-valuation-coverage

## Why

用户反馈估值温度计"指数和行业太少了"。当前 v1 只内置 **6 宽基指数 + 10 申万行业**。本改动把行业从 10 个扩到**全部 127 个申万三级行业**，指数维持 6 个不变。

指数不加的原因（2026-08-14 对真实 API 逐项实拉穷尽）:
- 纯浏览器(静态 GitHub Pages)可 fetch 的东财估值源只有 `RPT_VALUEMARKET`，其覆盖恰好 6 个市场(上证指数/沪深300/深证成指/创业板指/科创50/北证50 + 上证基金)。
- 上证50(000016)/中证500(000905)/中证1000(000852) 在该报表全部查空(`count=None`)；danjuan 有全量但无 CORS 头且当前直接 403；其余候选报表名全部"报表配置不存在"(code 9501)。
- 更多指数只能靠服务端代理(需部署后端, 项目从静态 Pages 变双端), 用户已确认不引入。

## What Changes

- **行业: 10 硬编码 → 127 动态枚举**。行业不再硬编码进 `BUILTIN_SYMBOLS`，改为运行时向 `RPT_VALUEINDUSTRY_DET` 发一次"最新交易日快照"查询(`filter=(TRADE_DATE='<最新交易日>')`，实测一次返回全部 127 个 `BOARD_CODE`+`BOARD_NAME`)，动态生成行业 symbol 列表。枚举列表与拉取结果一起写入 7 天 IDB 快照，后续访问走缓存无需重枚举。东财增删行业时列表自动跟随，不再需要手工维护 127 行硬编码。
- **指数: 保持 6 个硬编码**。`RPT_VALUEMARKET` 市场清单稳定，继续硬编码。
- **拉取: 全量拉完 → 渐进填充**。store 由"所有请求 resolve 后一次性替换 rows"改为"每个标的 resolve 后就地更新该行"，配合现有进度条，表格从首行 (~2s) 开始逐步填满，而不是干等 ~40s 全部结束。
- **性能(已实测)**: 用实际 `enumerateIndustrySymbols` + `fetchOne` 对真实东财全量拉 133 标的, **133/133 成功, 墙钟 ~11s**。渐进填充 + 7 天 IDB 缓存使该成本只在每 7 天首次点击时发生。曾评估的"月度日期快照"方案(~11.5s、60 个采样点/行业、月度分位)作为备选记录在 design.md，本轮不采用，保持与指数一致的日频分位口径。

## Capabilities

### Modified Capabilities
- `valuation-percentile-recommendation`: 「内置标的列表」由"6 指数 + 至少 10 个申万一级行业、硬编码"改为"6 指数硬编码 + 全部 127 个申万三级行业、运行时动态枚举"；「一键拉取估值分位」补充渐进填充与枚举失败的兜底行为。

## Impact

- `src/lib/valuation.ts` — `BUILTIN_SYMBOLS` 缩为仅 6 指数；新增行业枚举函数(最新交易日发现 + 127 行业快照解析)；`fetchOne` 逻辑不变。
- `src/stores/valuation.ts` — `fetchAll` 渐进填充(逐行就位)；枚举列表缓存与失败兜底(回退到 7 天快照里的行业列表)；`retryOne` 适配运行时行业符号。
- `src/types/valuation.ts` — 若无改动(枚举返回 `ValuationSymbol[]` 复用现有类型)。
- 测试 — 集成测试新增: 枚举 mock、127 行业渐进填充、枚举失败兜底；单元测试覆盖枚举解析。
- OpenSpec — 主 spec `valuation-percentile-recommendation` 的 2 条需求 MODIFIED。
