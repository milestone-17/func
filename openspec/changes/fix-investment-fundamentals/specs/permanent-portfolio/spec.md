## ADDED Requirements

### Requirement: 按 category 映射资产类别聚合

永久组合的实际占比聚合 SHALL 基于「持仓 `category` → 资产类别」映射：纳斯达克100 / 标普500 / 红利 → 股票；债券 → 债券；`category` 为「其他」时 SHALL 按持仓 `type` 字段回退映射（stock→股票、bond→债券、cash→现金、gold→黄金、etf/crypto→股票）。该规则 SHALL 使场外基金正确计入对应资产类别，而非因 `type=etf` 被排除。

#### Scenario: 红利基金计入股票类
- **WHEN** 一条持仓分类为「红利」且有市值
- **THEN** 其市值计入永久组合的「股票」实际占比

#### Scenario: 债券基金计入债券类
- **WHEN** 一条持仓分类为「债券」且有市值
- **THEN** 其市值计入永久组合的「债券」实际占比

#### Scenario: 未分类 ETF 回退计入股票
- **WHEN** 一条持仓分类为「其他」、type 为 `etf` 且有市值
- **THEN** 其市值计入「股票」实际占比（不再被排除）

#### Scenario: 无市值不计入
- **WHEN** 持仓无现价/净值为空，无市值
- **THEN** 其不计入任何类别，不产生错误占比

### Requirement: 永久组合反映全部持仓

永久组合总市值 SHALL 等于所有被映射持仓的市值之和；实际占比与目标占比偏差、再平衡提醒 SHALL 基于该总额计算。

#### Scenario: 总市值随净值更新
- **WHEN** 持仓净值被刷新（拉取或手动）
- **THEN** 永久组合总市值、各类实际占比与偏差随之重算
