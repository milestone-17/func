# 不可变约束（项目级，C-xx 编号）

> 任何代码变更不得违反以下约束。改动约束本身需要先在后台「Skill 知识库」记录原因并单独 commit。
> 校验器不做语义判断，但 SKILL.md 的「约束关联」章节必须引用这里的 ID，格式错误会被拦截。

## C-01 持仓数量守恒

- 规则：`Holding.quantity` 永远等于 Σ买入份额 − Σ卖出份额，不允许为负
- 违反后果：账本与交易流水失去对账基础（历史事故 P-93bbd21：持仓数量翻倍）
- 关联：`src/lib/ledger-sync.ts`、T-Holding、T-HoldingTxn

## C-02 摊薄成本法

- 规则：成本 = Σ买入金额 − Σ卖出金额×卖出比例；不实现移动平均/先进先出等其他成本法
- 关联：`src/lib/ledger-sync.ts`

## C-03 配置按用户隔离

- 规则：DcaConfig / DailyDcaConfig / DcaFund 等配置表的主键或唯一索引必须包含 userId 维度
- 违反后果：跨用户 id 冲突 409（历史事故 P-41e2f17、P-458ba4f）
- 关联：`server/prisma/schema.prisma`、T-DcaConfig、T-DailyDcaConfig

## C-04 安全上下文降级

- 规则：浏览器 API（如 crypto.randomUUID）必须有非安全上下文（HTTP）降级路径
- 违反后果：HTTP 部署下保存全挂（历史事故 P-fabec89）
- 关联：`src/` 全部前端代码

## C-05 数据源口径

- 规则：指数行情用腾讯 newfqkline（纳指 100 用 ^NDX 口径）；估值温度计用东财已验证报表；不做无实拉验证的数据源切换
- 违反后果：指数口径错误（P-65ac58a）/ 全量拉取失败（P-57b1780）
- 关联：`server/src/routes/`（market 相关）、T-ValuationSnapshot

## C-06 行情抓取限流退避

- 规则：外部行情请求必须带限流退避与重试，禁止同步循环高频请求
- 违反后果：被数据源封禁，线上 incidents（本条由 incidents 页自动记录监督）
- 关联：`server/src/lib/`（抓取器）

## C-07 登录守卫幂等

- 规则：auth init 必须幂等且并发共享同一 Promise；探活失败放行，由页面级 401 兜底
- 违反后果：竞态误踢登录（P-e322422）、WebView 掉登录（P-42b253a、P-5405c58）
- 关联：`src/`（auth 流程）

## C-08 前端自有结算

- 规则：定投结算逻辑在前端 `src/lib/settlement.ts`，服务端不做结算计算；新增结算规则改前端
- 关联：`src/lib/settlement.ts`、`src/lib/settlement.ts`

## C-09 SMTP 防限流

- 规则：邮件发送走连接池 + 全局节流 + 535 退避；新增邮件场景必须复用 `server/src/lib/mailer.ts` 既有通道
- 违反后果：SMTP 被限流（P-b0e58f6）
- 关联：`server/src/lib/`（mailer）

## C-10 schema 变更纪律

- 规则：Prisma schema 任何变更必须走 `prisma migrate dev` 生成迁移文件并提交，禁止手工改库
- 关联：`server/prisma/schema.prisma`、`server/prisma/migrations/`
