## 1. 基金净值数据源重写（fundQuote.ts）

- [x] 1.1 新增纯解析函数 `parseFundMNFInfo(payload)`：解析东财移动端接口响应 `Datas[]`，按 `FCODE` 建 `Map<code, { nav, navDate, isEstimate }>`；`NAV`（真实净值）优先、`GSZ`（估值）回退且标 `isEstimate=true`；无效/非正丢弃。导出便于单测
- [x] 1.2 新增批量 `fetchFundNavs(codes: string[], timeout=10000)`：一条 JSONP 脚本标签请求 `FundMNFInfo?Fcodes=<逗号拼接>&callback=<__fn_唯一名>`；成功调 `parseFundMNFInfo` 返回 Map；超时/onerror 清理脚本与全局回调后返回空 Map，不抛
- [x] 1.3 新增兜底 `fetchFundNavByPingzhongdata(code)`：脚本标签加载 `fund.eastmoney.com/pingzhongdata/{code}.js`，读取全局 `Data_netWorthTrend` 末元素 `y` 为净值（元），成功返回 `{ nav, isEstimate:false }`，失败/超时返回 null；仅作批量接口失败时的逐只兜底
- [x] 1.4 保留单只 `fetchFundQuote(code)`：复用 `fetchFundNavs([code])` 取单只，供单只手动刷新调用；回调名唯一，与批量并发不冲突

## 2. 路由与 push2 修正（yahoo.ts）

- [x] 2.1 `fetchHoldingPrice(market, symbol)`：6 位数字代码先试单只基金 JSONP（`fetchFundQuote`），失败再试东财 `push2`（补必需 `ut` 参数、`secid` 规则沿用：`6` 开头→`1.` 否则 `0.`，`f43/100` 为正才返回）；字母代码走 Yahoo 代理链；全失败返回 null
- [x] 2.2 新增批量入口 `fetchHoldingPrices(holdings)`（可选复用）：供 `refreshAllPrices` 一次收集 6 位代码批量拉取，非 6 位逐只走 Yahoo；返回值按 holdingId 归集

## 3. 批量刷新与有效分类（stores/portfolio.ts）

- [x] 3.1 `refresh()`：有效分类 = `h.category ?? inferCategory(h.name, h.symbol)`；对缺失 `category` 的持仓一次性 `holdingRepo.put` 补齐；`HoldingView.category` 用有效分类；`byCategory` 聚合沿用有效分类
- [x] 3.2 `refreshAllPrices()`：改为两段式——(a) 收集全部 6 位数字代码一次 `fetchFundNavs` 批量拉取，按 `FCODE` 回填各持仓 `currentPrice = yuanToFen(nav)`、`currentPriceAt = Date.now()`、`currentPriceIsEstimate`；未命中的 6 位代码走 `push2`；(b) 字母代码走 Yahoo 链。全部失败保留原值，仅计入 failed 列表
- [x] 3.3 `reclassifyAll` 语义保持（默认仅「其他」、可全量），返回改动数；与 `refresh()` 补齐逻辑不冲突

## 4. 永久组合按有效分类聚合

- [x] 4.1 `stores/permanent.ts` `analysis` computed：传入 `portfolio.holdings` 的有效分类（`h.category` 已为有效分类），`HoldingForPerm` 带 `category` 与 `type`
- [x] 4.2 `lib/permanent.ts` `categoryToAssetType` 映射校验：红利/纳指/标普→stock、债券→bond、other 按 type 回退（etf→stock）——行为不变，仅确认与有效分类输入一致；补「缺失分类经 inferCategory 兜底」的聚合断言

## 5. 测试

- [x] 5.1 `tests/unit/fundQuote.test.ts` 重写：用实测响应摘录（含 `NAV+PDATE`、`GSZ` 无 `NAV`、空/无效、多只混排）断言 `parseFundMNFInfo` 解析/优先级/错位隔离；`fetchFundNavs` 超时与 onerror 清理后返回空 Map 不抛；`fetchFundNavByPingzhongdata` 解析 `Data_netWorthTrend`
- [x] 5.2 `tests/unit/fetchHoldingPrice.test.ts` 更新：6 位走基金 JSONP、push2 带 `ut` 且 `f43>0` 才返回、基金在 push2 返回 null 时自然跳过、字母走 Yahoo 链
- [x] 5.3 新增「真实备份数据」回归用例（fixture 模拟净值）：用备份 16 只持仓跑 `inferCategory` + 有效分类聚合，断言债券基金归「债券」、红利/纳指/标普归「股票」、组合总市值正确、不再全 0
- [x] 5.4 `tests/e2e/app.py` 更新：JSONP mock 改为批量回调形态（`callback` 参数化）；覆盖「批量刷新回填净值」「存量自动分类」「永久组合含基金持仓显示比例与偏差」

## 6. 集成验证与上线

- [x] 6.1 `npm run test` 全绿（新增/更新单测 + 不破坏既有）— 153/153 通过
- [x] 6.2 `npm run build`（vue-tsc + vite）通过
- [x] 6.3 `npm run test:e2e` 通过 — 31/31, 无未预期控制台错误
- [ ] 6.4 提交推送上线，用 `func-backup-20260813-0907.json` 数据线上验证：现价批量拉到真实净值（非「—」）、存量自动分类生效、永久组合显示正确比例与偏差
