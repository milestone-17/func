## MODIFIED Requirements

### Requirement: 中国基金净值 JSONP 拉取

对 6 位基金代码，系统 SHALL 通过东财移动端基金接口（`fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo`）以 JSONP（`<script>` 标签发起、不受浏览器 CORS 限制）拉取基金净值；对全部 6 位基金代码，系统 SHALL 在**一次请求**中批量获取其真实单位净值 `NAV` 与净值日期 `PDATE`。拉取成功时 SHALL 优先采用真实单位净值 `NAV`，缺失时使用盘中估值 `GSZ` 并可在 UI 标注为估值。

#### Scenario: 批量拉到单位净值
- **WHEN** 系统一次 JSONP 请求基金 `006260,019261,...` 并返回每只基金的 `NAV` 与 `PDATE`
- **THEN** 每只持仓按其代码取到对应的单位净值作为现价（元），互不错位

#### Scenario: 仅返回估值时使用估值
- **WHEN** 某基金返回数据无 `NAV` 但有盘中估值 `GSZ`
- **THEN** 系统使用该估值作为现价，并可在 UI 标注其为估值

#### Scenario: 代码无数据或不存在
- **WHEN** JSONP 返回空、无有效数值、或基金代码不存在
- **THEN** 系统 SHALL 对该代码返回失败（null），绝不返回 0 或错误数值，且不影响同一批次其他代码的结果

### Requirement: 通用覆盖新增基金

系统 SHALL 对用户后续新增的任意 6 位基金代码自动纳入批量拉取，无需逐只配置；对字母代码（美股等）SHALL 走既有 Yahoo 代理链。6 位数字代码中的非基金（A 股股票）SHALL 尝试东财股票接口（`push2.eastmoney.com`，携带必需 `ut` 参数）拉取，基金代码在该接口返回空时自然跳过。

#### Scenario: 新增基金自动拉取
- **WHEN** 用户新增一只此前未录入的 6 位基金代码持仓并打开投资页
- **THEN** 系统自动将其纳入批量 JSONP 拉取，无需额外配置

#### Scenario: 字母代码走代理链
- **WHEN** 持仓代码为字母（如 QQQ）
- **THEN** 系统走 Yahoo 代理链拉取，不走基金 JSONP

#### Scenario: A 股股票走 push2
- **WHEN** 6 位数字代码为 A 股股票（如 600519）
- **THEN** 系统经东财 push2 接口（携带 `ut`）拉取现价

### Requirement: 并发安全

系统 SHALL 为每次 JSONP 请求使用可自定义/唯一的回调名隔离，SHALL 避免并发拉取（批量请求与单只刷新同时发生时）互相覆盖回调，确保每只基金拿到自己的净值。

#### Scenario: 批量与单只刷新并发不串值
- **WHEN** 批量拉取与单只刷新同时发起
- **THEN** 各请求使用独立回调名，结果互不干扰、一一对应

#### Scenario: 多只基金依次拉取不串值
- **WHEN** 同时存在多只基金需拉取
- **THEN** 每只持仓拿到的净值与其代码一一对应，不发生错位
