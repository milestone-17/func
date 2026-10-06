---
name: server-backend
description: Fastify 后端：路由分层约定、Prisma/SQLite、行情抓取多源降级、cron 任务
globs:
  - server/src/**
  - server/prisma/schema.prisma
alwaysApply: false
---

# 服务端（L2 核心知识）

## 架构

- Fastify 5 + TypeScript，入口 `server/src/index.ts` → `buildApp`（`server/src/app.ts`）
- 路由按域拆分：auth/crud/import/market/proxy/admin/notifications（`server/src/routes/`）
- ORM：Prisma + SQLite，schema 在 `server/prisma/schema.prisma`（结算逻辑在前端 `src/lib/settlement.ts`，服务端不含），迁移用 `prisma migrate`
- 认证：用户 JWT（@fastify/jwt, cookie func_token）；管理后台独立 HMAC token（admin_token, 2h, kind=admin）

## 行情数据

- 多源降级：`server/src/lib/market-fetcher.ts`（SOURCE_PRIORITY 可在后台调整）
- 天天基金解析：`server/src/lib/fundgz.ts`、`server/src/lib/quote-fetch.ts`
- 定时任务：`server/src/cron/market.ts`（node-cron 每日收盘后抓取历史净值）

## 部署

- systemd `func.service`：`node dist/index.js`（先 `npm run build` 生成 server/dist）
- 单容器静态托管：`/func/` 用户端 + `/_admin/` 管理端（见 `server/src/app.ts#buildApp`）

## 代码地图

- panel API 守卫与审计 → `server/src/routes/admin.ts#requirePanel / audit`
- 新增 admin API 的规范 → [references/admin-route-pattern.md](./references/admin-route-pattern.md)

## 反向校验锚点

- `server/src/app.ts`（注册路由顺序、静态托管）
- `server/prisma/schema.prisma`（模型字段）
- 修改 schema 后必须 `prisma migrate dev` 并提交迁移目录
- `server/src/lib/skill-repo.ts`（skill 知识库仓库层）
