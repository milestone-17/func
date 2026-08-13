## Context

上一轮 `enhance-investment-features` 上线后线上实测暴露三个缺陷（见 `proposal.md - Why`）：① 中国场外基金净值在手机浏览器拉不到（CORS）；② 基金全分到「其他」（无自动分类）；③ 永久组合全 ¥0.00（`type=etf` 被排除 + 无净值）。动机见 proposal，行为契约见 specs。

关键现状：
- 用户基金为中国场外公募基金（6 位代码，如 `006260`），每天一个净值，非实时价。
- `fetchHoldingPrice(market, symbol)` 现按 market 路由（US→Yahoo 代理链、CN→东方财富股票 `push2` 接口）。`push2` 是**股票**接口，对基金代码无效且 CORS 受限 → 全失败。
- 持仓 `category` 字段已存在（上轮加），但新建默认 `other`、无自动推断。
- 永久组合 `computePermanentDeviation` 按 `type`(stock/bond/cash/gold) 聚合，`etf` 被过滤 → 基金不计入。

## Goals / Non-Goals

**Goals:**
- 中国场外基金净值：线上可尽力自动拉取（JSONP 绕 CORS），覆盖任意 6 位代码含新增。
- 持仓自动分类：按名称/代码推断 + 一键批量重算，修复历史「其他」。
- 永久组合：按 `category` 正确映射聚合，反映用户全部持仓比例。
- 失败绝不写错误价，保留原值。

**Non-Goals:**
- 不接付费/官方承诺行情源（纯前端、无后端、无密钥）。
- 不做后台定时拉取（浏览器限制）；拉取在页面打开时触发。
- 不改 schema（`category` 字段已存在）。
- 不保证 100% 拉得到（第三方免费接口，尽力 + 失败保留）。

## Decisions

### D1：数据源——天天基金 JSONP（`fundgz.1234567.com.cn`）
该接口返回形如 `jsonpgz({"fundcode":"006260","name":"...","dwjz":"1.2345","gsz":"1.24","gszzl":"0.8","gztime":"..."});`，`<script>` 标签加载即 JSONP，**绕过 CORS**，GitHub Pages（https）同源策略不拦 script。
- 取值优先级：真实单位净值 `dwjz` > 估算值 `gsz`（两者均元为单位，`yuanToFen`）。
- 回调名固定 `jsonpgz`：**串行化拉取**（一次一只）或用回调队列，避免并发覆盖 `window.jsonpgz` 串值。选串行（个人持仓数量小，简单可靠）。
- 超时（~8s）→ resolve(null)，清理 script 与全局回调。
- *替代方案*：新浪/腾讯基金 JSONP——接口形态类似，`fundgz` 最通用稳定，先用它；失败保留可后续扩展多源。
- *替代方案*：自建 Cloudflare Worker 代理——需额外服务，违背纯前端，否决。

### D2：`fetchHoldingPrice` 路由改为「按代码形态」
不再按 `market`（US/CN）路由，改为按 `symbol` 形态：
- 纯 6 位数字（含基金与 A 股）→ 先试基金 JSONP（`fetchFundQuote`）；基金接口对股票代码返回空 → 再试东方财富股票 `push2`（保留，尽力）。
- 含字母（美股/ETF 如 QQQ）→ Yahoo 代理链（`fetchLiveLatestPrice`）。
- 任一成功且为正值 → 返回；全失败 → null（保留原值）。
这样新增任意代码都自动走对应源，满足「新增基金也能拉」。

### D3：自动分类——`inferCategory(name, symbol)` 关键词推断
新增 `src/lib/category.ts`：
```
inferCategory(name, symbol):
  s = (name + ' ' + symbol).toLowerCase()
  if /红利|股息|dividend/ → 'dividend'
  if /标普|s&p|sp500|spy|spx|500etf/ → 'sp500'
  if /纳指|纳斯达克|qqq|ndx|nasdaq/ → 'nasdaq100'
  if /债|bond/ → 'bond'
  else → 'other'
```
- 新建表单：`watch(form.name/symbol)` 时自动设 `form.category = inferCategory(...)`（用户可改）。
- 一键重分类：遍历 `holdings`，对「其他」的（默认）或全部（可选）按规则重算并 `holdingRepo.put`。UI 给「仅重算未分类」范围选项，避免覆盖用户手动设置。

### D4：永久组合——`categoryToAssetType` 映射
新增映射函数（`src/lib/permanent.ts` 或 `category.ts`）：
```
categoryToAssetType(category, type?):
  nasdaq100|sp500|dividend → 'stock'
  bond → 'bond'
  (other 或缺省) → 按 type: stock→stock, bond→bond, cash→cash, gold→gold, etf|crypto → stock
```
`computePermanentDeviation` 的入参 `HoldingForPerm` 增 `category`；聚合时用 `categoryToAssetType(h.category, h.type)` 决定归类。`permanent` store 的 `analysis` computed 传入 `category`。这样红利/纳指/标普基金计入股票、债券基金计入债券，`etf` 不再被排除。

### D5：无 schema 变更
`category` 字段上轮已加（schemaless，无需迁移）。旧持仓无 `category` → 视为 `other` → 按 `type` 回退。一键重分类可补齐。

## Risks / Trade-offs

- [`fundgz` 第三方接口不稳/限流/下线] → 尽力拉取 + 失败保留原值 + 明确提示；预留多源扩展点（D1 备选）。绝不写错误价。
- [JSONP 回调名 `jsonpgz` 固定，并发串值] → 串行化拉取（D1）。
- [估算值 `gsz` 非真实净值] → 优先 `dwjz`；用 `gsz` 时 UI 标注「估值」，透明告知。
- [自动分类误判] → 关键词规则保守 + 用户可改 + 一键重分类只动「其他」默认；不强制覆盖手动设置。
- [`fundgz` 只覆盖公募基金，不含 ETF 场内/股票] → D2 路由对股票代码回落 `push2`；场内 ETF 走基金接口（多数也支持）或手动。
- [mixed-content] → 用 `https://fundgz.1234567.com.cn`（站点是 https）。

## Migration Plan

无数据迁移。发布即生效：用户刷新页面（强刷清 PWA 缓存）后，投资页自动用 JSONP 重拉净值、一键重分类修复历史分类、永久组合按新映射显示比例。

## Open Questions

- 「一键重新自动分类」默认范围：仅「其他」 vs 全部？设计给选项（默认仅「其他」，保守不覆盖手动设置），可在实现后据用户反馈调整默认。
