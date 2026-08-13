## Context

上一轮 `fix-investment-fundamentals`（已提交）选用的净值源 `fundgz.1234567.com.cn` 实测失效：对任意基金代码返回 HTML「页面未找到」而非 JSONP；其备用 `push2` 缺少 `ut` 参数返回空响应。三大症状（现价全空、基金全在「其他」、永久组合 ¥0.00）根因见 `proposal.md - Why`，行为契约见各 `specs`。

已用真实备份（`func-backup-20260813-0907.json`，16 只基金全部 6 位数字代码、`type=etf`、无一条带 `category`）与真实接口实测确认：
- `fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo` 可用：`callback` 参数化 JSONP、单次批量返回 `NAV/PDATE/GSZ`（元）、负载极小。
- `fund.eastmoney.com/pingzhongdata/{code}.js` 也可用但单文件 ~281KB（16 只 ≈ 4.5MB，移动端过重），仅作最终兜底候选。
- `push2.eastmoney.com` 补 `ut` 后对 A 股股票有效（600519 → f43=135631），对基金返回 `data:null`。
- 现价以「分」存储（`yuanToFen` 已存在且正确），净值接口以「元」返回。

## Goals / Non-Goals

**Goals:**
- 一次批量 JSONP 拉取全部 6 位基金净值，替换失效源；字母代码仍走 Yahoo 链。
- 存量持仓读取即自动分类（有效分类 = 已存 ?? `inferCategory`），并持久化补齐。
- 永久组合用有效分类聚合，缺失分类以 `inferCategory` 兜底。
- 单测/集成基于真实响应结构 fixture，杜绝「mock 全绿、生产全坏」。

**Non-Goals:**
- 不接付费/官方承诺行情源、不引入后端。
- 不做定时后台拉取（浏览器约束）。
- 不改 schema（`category` 字段已存在）。
- 不保证 100% 拉得到（第三方免费接口，尽力 + 失败保留）。

## Decisions

### D1：数据源 = 东财移动端批量 JSONP（主），pingzhongdata（兜底）
`FundMNFInfo` 接口：`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=100&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=wxf&Fcodes=006260,019261&callback=<唯一名>`。
- 一次脚本标签请求返回全部代码的 `Datas[]`（`FCODE`/`SHORTNAME`/`NAV`/`PDATE`/`GSZ`）。
- 取值：`NAV`（真实净值）优先，`GSZ`（盘中估值）回退并标「估」。
- 回调名参数化 → 每次请求用 `__fn_<rand>`，无固定名串值问题（修掉上一轮 jsonpgz 隐患）。
- 兜底链：批量接口失败 → 逐只 `pingzhongdata/{code}.js`（读取全局 `Data_netWorthTrend` 末元素 `y`）→ 全败返回 null（保留原值）。pingzhongdata 仅兜底，避免正常路径 4.5MB。
- *替代方案*：`fundgz`（已死）、新浪 `hq.sinajs.cn`（基金返回空）、腾讯 `qt.gtimg.cn`（`v_pv_none_match`）、`push2` 股票接口（基金返回 null）——实测均不可用于基金，仅 `push2` 保留用于股票。

### D2：路由与批量架构
`refreshAllPrices` 改为两段式：
1. 收集全部 6 位数字代码 → 一次批量基金 JSONP；成功则按 `FCODE` 回填各持仓（元→分 `yuanToFen`），并记 `PDATE` 到 `currentPriceAt`。
2. 对未命中的 6 位数字代码（接口无数据，可能是股票）→ 逐只 `push2`（补 `ut`，`secid` 规则沿用 `6` 开头→`1.`，否则 `0.`）；字母代码 → Yahoo 代理链。
单只手动刷新（`Portfolio.vue` 的 `fetchHoldingPrice`）保持按代码形态路由，内部复用同一基金 JSONP（单只请求）。

### D3：有效分类自动生效
`portfolio` store `refresh()`：每条持仓计算 `effectiveCategory = h.category ?? inferCategory(h.name, h.symbol)`；对 `category` 缺失的持仓一次性 `holdingRepo.put` 补齐（避免反复推断）。`byCategory` 聚合与 `permanent` 的 `analysis` 均用有效分类。`reclassifyAll('unclassified'|'all')` 语义保留（用于用户主动重算）。

### D4：永久组合聚合用有效分类
`HoldingForPerm` 传入 `category`（有效分类）；`categoryToAssetType` 保持「category → 资产类别」映射 + `other` 按 `type` 回退。由于 D3 已把缺失分类补齐，`permanent` 聚合天然正确；不再单独在 `permanent` 里推断（避免两处规则漂移）。

### D5：测试用真实结构 fixture
- `tests/unit/fundQuote.test.ts`：用**实测响应摘录**（`NAV/PDATE/GSZ` 组合）断言解析、优先级、批量错位隔离、超时降级。
- `tests/unit/fetchHoldingPrice.test.ts`：断言批量→push2→Yahoo 的回落链（`ut` 参数在 URL 中、基金在 push2 返回 null 时自然跳过）。
- 新增「真实备份数据」回归用例：用备份的 16 只持仓跑 `inferCategory` + 聚合，断言债券基金归「债券」、组合不再全 0（价格以 fixture 模拟）。
- E2E 的 JSONP mock 相应更新为批量回调形态。

## Risks / Trade-offs

- [东财免费接口限流/改版/下线] → 兜底链（pingzhongdata）+ 失败保留原值 + 明确提示；`ut` 为公开固定参数非密钥。
- [批量接口某只无数据拖累整体] → 按 `FCODE` 分别判定，单只失败不影响其余（spec 已有场景）。
- [`NAV` 为 T-1 净值非实时] → 现价标签语义清晰（真实净值日期 `PDATE`）；`GSZ` 估值时标注「估」。
- [移动端一次批量 JSONP 的脚本大小] → 批量接口负载极小（16 只约 6KB）；pingzhongdata 兜底路径才触达 281KB/只，可接受。
- [混合内容/HTTPS] → 接口均为 `https://`，GitHub Pages（https）下无 mixed-content。

## Migration Plan

无数据迁移。发布后刷新：首次进入自动补齐分类、自动批量拉净值、永久组合恢复比例。回滚：仅前端代码，回退上一提交即可，数据无副作用（只增不改 category/price 字段语义）。

## Open Questions

- 无阻塞性开放问题。「存量自动补齐分类」与「一键重分类默认仅未分类」是否会覆盖用户手动设置的边界，spec 已定义（手动优先）；具体 UI 文案可在实现后微调。
