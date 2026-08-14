# Tasks: verify-valuation-live-fetch

> 本轮对真实东财 API 逐项 curl 实拉验证, 推翻了上一轮"双重编码"根因判断。
> 真正根因: push2 f162/f167 对指数返回 0 + `RPT_VALUATIONANALYSIS` 报表不存在 (9501)。

## 1. 实拉验证数据源 (定位真根因)

- [x] 1.1 逐项 curl 东财 push2 / datacenter-web / danjuan, 确认 CORS 与数据可用性
- [x] 1.2 确认 push2 `stock/get` f162/f167 对指数返回 0 → 快照源不可用
- [x] 1.3 确认 `RPT_VALUATIONANALYSIS` 报表不存在 (code 9501) → 历史源不可用
- [x] 1.4 确认 `RPT_VALUEMARKET` (指数, PE_TTM_AVG, 500 条/页) + `RPT_VALUEINDUSTRY_DET` (行业, PE_TTM/PB_MRQ, 一次拿全) 可浏览器 fetch
- [x] 1.5 确认 danjuan 数据全但无 CORS → 浏览器不可用, 排除
- [x] 1.6 模拟新 fetch 逻辑对全部 16 个标的实拉 → 16/16 成功 (见 design.md 验证表)

## 2. 重写 fetch 层

- [x] 2.1 `src/lib/valuation.ts`: 删除 push2 快照 (`parseEastmoneySnapshot`/`fetchSnapshot`) 与 `RPT_VALUATIONANALYSIS` 历史
- [x] 2.2 新增 `fetchMarketValuation` (RPT_VALUEMARKET 翻页 500/页) + `fetchIndustryValuation` (RPT_VALUEINDUSTRY_DET 一次拿全)
- [x] 2.3 最新一行 = 当前值, 其余 = 历史序列; 不再需要独立快照请求
- [x] 2.4 `parseEastmoneyValuationHistory` 支持 `peField`/`pbField` 参数 + `TRADE_DATE` 时间后缀 + `PB_MRQ`
- [x] 2.5 标的清单对齐可用数据: 6 指数改为 RPT_VALUEMARKET 覆盖的市场, 10 行业改为代表性申万三级
- [x] 2.6 `src/stores/valuation.ts`: `fetchAll` 串行改并行 (指数翻页后串行太慢)

## 3. 测试 (自己跑, 不再让用户跑)

- [x] 3.1 集成测试 mock 改为真实报表 shape + 分页行为 (`makePagingFetchMock`), 覆盖正常/翻页/极值/失败/URL 无 %25
- [x] 3.2 单元测试移除废弃的 `parseEastmoneySnapshot`, 新增时间后缀 / PE_TTM_AVG / PB_MRQ 用例
- [x] 3.3 `npm test` → 281/281 通过
- [x] 3.4 `npx vue-tsc --noEmit` → 0 错误

## 4. 浏览器实测 (用户跑)

- [ ] 4.1 `npm run dev` → 打开 `/suggest` → 点击"拉取估值"
- [ ] 4.2 验收: 16 行 PE-TTM 全部有数字 (指数 PB 显示 "—", 报表无 PB 字段)
- [ ] 4.3 验收: 分位列 0-100 整数, 至少 2-3 种档位颜色 (绿/蓝/红)
- [ ] 4.4 验收: 失败时 failReason 不再是 `history-empty` (即数据真的从东财回来了)
- [ ] 4.5 若仍失败 → DevTools F12 → Console / Network 里 `datacenter-web.eastmoney.com` 请求的响应贴回来
