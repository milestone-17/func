## Why

上一轮 `fix-investment-fundamentals`（已提交 9a652c5）宣称修复的三个问题，用真实备份数据（`func-backup-20260813-0907.json`）实测后**一个都没有解决**：

1. **行情拉取依旧全失败**：所选数据源 `fundgz.1234567.com.cn` JSONP 实测对所有 6 位基金代码（含 `000001` 等主流代码）都返回 HTML「页面未找到」而非 JSONP——接口已失效/被限。备用 `push2.eastmoney.com` 请求缺少必需 `ut` 参数，返回空响应。结果 16 只基金现价全部为 null，UI 全显「—」+「行情拉取失败」。
2. **基金仍全在「其他」**：备份中 16 条持仓**没有一条带 `category` 字段**。上一轮只做「新建表单预填」+ 手动「一键重分类」按钮，存量数据不点按钮就永远不会分类。
3. **永久组合仍 ¥0.00**：无净值 → 无市值 → 全部被过滤（实测 16 只仅 1 只有价，组合总值 ¥79.76）；且即使有价，未分类的 `etf` 会被 `categoryToAssetType` 一律归「股票」，债券基金也会被错算进股票。

为什么没解决：上一轮的单测/E2E 全用 mock 数据源（从未对真实接口验证），测试全绿掩盖了「生产接口根本不可用」。本次以真实数据 + 真实接口验证为准。

## What Changes

- **替换基金净值数据源（核心）**：弃用失效的 `fundgz` JSONP，改用**东财移动端基金接口 `fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo`**——经实测：支持 JSONP `callback` 参数（脚本标签加载、无 CORS、回调名可自定义无串值）、返回真实单位净值 `NAV` 与净值日期 `PDATE`（元）、**一次请求批量返回全部基金代码**、负载极小（16 只约 6KB）。`GSZ` 盘中估值为回退。
- **修正 `push2` 备用接口**：补上必需 `ut` 参数（实测补上后对 A 股股票返回 `f43` 正确；基金返回 `data:null` 自然跳过）。服务于 6 位数字代码中的非基金（股票）。
- **分类对存量自动生效**：持仓读取时有效分类 = `category ?? inferCategory(name, symbol)`，内存立即生效并持久化补齐；手动分类优先、不被覆盖。不再要求用户手动点「一键重分类」。
- **永久组合按有效分类聚合**：聚合路径同样以 `inferCategory` 兜底，未分类基金不再一律归「股票」（红利/纳指/标普 → 股票、债券 → 债券），配合有净值后有市值，永久组合恢复显示持仓比例与偏差。
- **验证不再自欺**：单测/集成改用真实接口返回结构的**静态 fixture**（截取自实测响应）断言解析与降级，E2E 对脚本注入 mock；并新增一条**真实数据驱动**的回归用例（用备份中的 16 只持仓跑 `inferCategory` + 聚合）。

## Capabilities

### Modified Capabilities
- `fund-quote-source`: 净值拉取源改为东财移动端批量 JSONP 接口（真实 `NAV` 优先、`GSZ` 估值回退、一次批量全部代码、失败保留原值）；`push2` 备用接口补 `ut` 参数。
- `investment-portfolio`: 有效分类 = 存储分类 ?? `inferCategory(name, symbol)`，存量持仓读取即自动分类并持久化，无需手动操作。
- `permanent-portfolio`: 聚合时对缺失分类以 `inferCategory` 兜底归类，`etf` 不再一律算股票。

## Impact

- **数据源**：`src/lib/fundQuote.ts` 重写——新增批量 `fetchFundNavs(codes)`（单次 JSONP 拉全部、解析 `Datas[].NAV/PDATE/GSZ`）、保留单只 `fetchFundQuote`（供单只刷新用同一接口）；`src/lib/yahoo.ts` 的 `fetchHoldingPrice` 改走新源、`push2` 补 `ut`。
- **分类**：`src/stores/portfolio.ts` `refresh()` 计算有效分类并持久化；`reclassifyAll` 语义不变。
- **永久组合**：`src/lib/permanent.ts` / `src/stores/permanent.ts` 传入有效分类。
- **测试**：`tests/unit/fundQuote.test.ts`、`fetchHoldingPrice.test.ts` 改用真实响应 fixture；新增「真实备份数据」回归用例；`tests/e2e/app.py` 的 JSONP mock 更新。
- **兼容**：无 schema 变更；旧持仓无 `category` 时读取即自动补齐。
- **约束说明**：东财免费接口偶发限流/下线，按「尽力拉取 + 失败保留原值」设计；`ut` 为公开接口的固定参数，非密钥。
