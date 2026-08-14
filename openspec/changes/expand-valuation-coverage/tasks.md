# Tasks: expand-valuation-coverage

> 把行业从 10 个硬编码扩到全部 127 个申万三级(运行时动态枚举), 指数保持 6 个。
> 数据可行性已对真实 API 实拉验证(127/127 行业历史成功, 枚举一次拿全 127 行业)。

## 1. lib: 拆分标的清单 + 新增行业枚举

- [x] 1.1 `src/lib/valuation.ts`: `BUILTIN_SYMBOLS` 改名/收窄为 `BUILTIN_INDICES`(仅 6 指数, 内容与现状一致); 删除 10 个硬编码行业
- [x] 1.2 新增 `enumerateIndustrySymbols(anchorDate?: string): Promise<ValuationSymbol[]>`: 传 `anchorDate` 则直接用, 否则在 `RPT_VALUEINDUSTRY_DET` 上发 `filter=(TRADE_DATE<='今天')` pageSize=1 取最新交易日(实测 1 次请求即可); 再发 `filter=(TRADE_DATE='<date>')` columns=`BOARD_CODE,BOARD_NAME,PE_TTM,PB_MRQ` 一次拿全 127 行 → 生成 `kind:'industry'` 的 symbol 列表
- [x] 1.3 枚举请求复用现有 `requestData`(filter 单次编码, 不出现 %25); 失败抛带前缀 Error(`enum-fail: ...`), 由 store 兜底
- [x] 1.4 新增纯函数 `parseIndustryEnumeration(payload): { code, name, peTtm, pb }[]` 供单元测试直接测

## 2. store: 渐进填充 + 枚举兜底

- [x] 2.1 `src/stores/valuation.ts` `fetchAll`: 符号列表 = `BUILTIN_INDICES` + `enumerateIndustrySymbols()`; 枚举失败时从最近 7 天内快照 rows 反推行业 symbol 列表(无缓存则仅指数), 不抛错
- [x] 2.2 `fetchAll` 渐进填充: 把最后统一 `rows.value = results` 改为每个 Promise resolve 后 `rows.value[idx] = row` 就地更新, 进度条同步推进
- [x] 2.3 store 保存最近一次 `industrySymbols`(ref), `retryOne` 改为在 `BUILTIN_INDICES` + 该列表里按 code 匹配
- [x] 2.4 快照写入/7 天加载/全失败 staleFallback 逻辑保持现状(快照 rows 已含全部行, 无需 schema 变更)

## 3. 测试 (自己跑)

- [x] 3.1 单元测试: `parseIndustryEnumeration` 正常/空/字段缺失; `enumerateIndustrySymbols` 无 anchorDate 时先取最新日期
- [x] 3.2 集成测试 (`tests/integration/valuation.fetch.test.ts`): 新增"枚举 127 行业 → fetchAll 渐进填充"用例(逐行就位断言); 枚举失败兜底到缓存列表用例; 现有 16 标的用例改为 `BUILTIN_INDICES`
- [x] 3.3 `npm test -- --run` 全绿
- [x] 3.4 `npx vue-tsc --noEmit` 0 错误
- [x] 3.5 实拉冒烟: 模拟新 fetchAll(枚举 + 127 行业历史) 对真实 API 全量跑通, 记录耗时与成功数(实际代码 133/133, ~11s)

## 4. 浏览器实测 (用户跑)

- [ ] 4.1 `npm run dev` → 打开 `/suggest` → 点击"拉取估值"
- [ ] 4.2 验收: 表格渐进填充, 最终 133 行 (6 指数 + 127 行业), 指数 PB 列"—"
- [ ] 4.3 验收: 搜索"银行"能过滤出银行相关行业; 切"选型"排序最高估在最上
- [ ] 4.4 验收: 失败行可"重试"; 若全部失败 → toast 提示本地快照
- [ ] 4.5 若某行业拉取失败 → F12 Network 里 `datacenter-web.eastmoney.com` 该行请求的响应贴回来
