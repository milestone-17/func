# admin 路由新增规范（L3）

## 模式

```ts
app.get('/api/admin/panel/xxx', { preHandler: requirePanel }, async (req) => { ... })
```

- requirePanel：校验 admin_token cookie（HMAC，独立于用户 JWT）
- 写操作后调用 `audit(actor, action, target, detail)` 落审计表
- 返回统一 `{ items }` / 直接对象，错误 `{ error }` + 对应状态码

## 注意

- admin.ts 已 698 行，新功能域建议拆新文件并注册到 `server/src/app.ts`
- rate limit：登录类接口加 `config: { rateLimit: { max, timeWindow } }`
