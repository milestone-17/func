# AGENTS.md — func 项目知识索引

> 本文件是 AI Agent 的全局入口。采用「三层知识架构 + 渐进式披露」：
> L1 本索引（只放一句话概览）→ L2 各 Skill 的 SKILL.md（模块核心知识）→ L3 references/（按需加载的细节）。
> 修改任何 skill 后必须更新本索引，并让对应的 SKILL.md 与代码保持同步。

## 项目概览

- 名称：func（个人基金投资管理），monorepo：前端 `src/`（Vue3 + Vite）、管理后台 `admin-web/`（soybean-admin + element-plus）、后端 `server/`（Fastify + Prisma + SQLite）
- 部署：单容器模式，systemd 服务 `func.service`，服务 `server/dist/index.js`，静态托管 `/func/`（用户端）与 `/_admin/`（管理端）
- 开发约定：语义化提交（feat/fix/refactor/perf + scope），中文提交信息；功能开发在 feat/* 分支，验证后合回主分支

## Skill 索引

| Skill | 一句话概览 | 入口 |
|-------|-----------|------|
| finance-domain | 基金/持仓/账本领域模型与业务规则 | [SKILL.md](./finance-domain/SKILL.md) |
| dca-settlement | 定投模拟、周期扣款与收益结算算法 | [SKILL.md](./dca-settlement/SKILL.md) |
| kline-chart | K 线图 canvas 自绘、MA/成交量/复权 | [SKILL.md](./kline-chart/SKILL.md) |
| server-backend | Fastify 路由分层、Prisma schema、行情抓取 | [SKILL.md](./server-backend/SKILL.md) |
| admin-panel | 管理后台页面接线（elegant-router/菜单/i18n）与 panel API | [SKILL.md](./admin-panel/SKILL.md) |
| usage-guide | Skill 机制使用指南：四场景用法、维护流程、后台查看与防腐巡检 | [SKILL.md](./usage-guide/SKILL.md) |

## 防腐规则（四层校验）

1. **反向校验**：AI 改动代码后，检查 SKILL.md 中引用的文件路径/函数是否仍然存在
2. **沟通补充**：每次迭代发现新知识，先和用户确认再写入 skill
3. **Commit 前校验**：提交涉及某模块时，diff 该模块的 SKILL.md 是否需要同步更新
4. **基线巡检**：后台「Skill 知识库」页面可对照 git 历史巡检文档与代码的漂移

## 知识维护流程

1. 新增/修改知识 → 编辑对应 `skills/<name>/SKILL.md` 或 `references/*.md`
2. 引用代码必须带相对路径 + 函数/行号锚点，如 `src/lib/settlement.ts#isSettled`
3. git commit 提交（迭代历史由 git 记录，后台可查看）
4. 更新本索引中该 skill 的一句话概览（如语义变化）
