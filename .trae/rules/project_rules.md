# func 项目知识规则（Skill 机制）

本仓库采用「三层知识架构 + 渐进式披露」。开始任何开发任务前：

1. 先读 `skills/AGENTS.md`（全局索引，只含各模块一句话概览）
2. 根据任务涉及的模块，只读对应 `skills/<模块>/SKILL.md`（核心知识 + 代码地图）
3. 需要细节时才读该模块的 `references/*.md`，不要一次性全量加载

## 防腐规则

- 改动代码后，反向校验对应 SKILL.md 中的文件路径/函数锚点是否仍存在
- 提交涉及某模块的变更时，检查该模块 SKILL.md 是否需要同步更新
- 知识变更单独 commit（如 `docs(skill): ...`），后台「Skill 知识库」页面会展示迭代历史

## 项目约定

- 功能开发在 feat/* 分支，验证后合并，不直接动 main
- 语义化提交：`feat|fix|refactor|perf(scope): 中文描述`
- 部署：`server` 目录 `npm run build` 后 kill 3000 端口进程（systemd 自动拉起）；`admin-web` 目录 `pnpm build`
- 管理后台新增页面：`src/views/<name>/index.vue` + i18n route 标题 + elegant-router 三件套（见 skills/admin-panel/SKILL.md）
