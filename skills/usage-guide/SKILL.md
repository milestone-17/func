---
name: usage-guide
description: "Skill 知识库的完整使用指南：日常开发怎么用、维护流程、后台查看、防腐巡检"
globs: []
alwaysApply: false
---

# usage-guide — Skill 机制使用指南（L2）

本 skill 是给**人和 AI 操作者**看的使用手册，与代码实现解耦：机制怎么变，这里跟着改即可。

## 一、机制速览

- **三层知识**：`skills/AGENTS.md`（L1 索引）→ `skills/<name>/SKILL.md`（L2 核心）→ `skills/<name>/references/*.md`（L3 细节），渐进式披露，避免全量加载撑爆上下文
- **四层防腐**：反向校验（validate.mjs）→ 沟通补充（新知识先确认）→ commit 前校验（pre-commit hook）→ 基线巡检（后台健康巡检 Tab）
- **迭代可视**：知识变更 = git commit，后台自动呈现时间线与版本 diff，无额外存储

## 二、日常使用四场景

### 场景 1：AI 开发时（零操作）

Trae 远程打开本仓库时，agent 自动读根目录 `AGENTS.md` + `.trae/rules/project_rules.md`，按需加载三层知识。正常提需求即可，无需提示“读文档”。

本地/SSH 会话则开场说一句：“先读 skills/AGENTS.md 再做 xxx”。

### 场景 2：改代码后同步知识（关键习惯）

提交涉及某模块代码时，检查对应 SKILL.md 是否需要同步：

```bash
# pre-commit hook 自动校验锚点（.githooks/pre-commit，经 core.hooksPath 启用）
git commit -m "fix(ledger): xxx"

# 改了文件名/函数名会被拦下，跑校验器看漂移点，修完再提交
node skills/scripts/validate.mjs        # [--json] 可机读
```

文档有实质变更就单独 commit（`docs(skill): ...`），后台迭代历史自动多一条。

### 场景 3：新增知识/新模块

```bash
bash skills/scripts/new-skill.sh <name> "一句话描述"
# 填写生成的 SKILL.md，并在 AGENTS.md 索引表加一行
git add skills/ && git commit -m "docs(skill): 新增 <name>"
```

### 场景 4：浏览器查看（后台管理）

登录 `/​_admin/` → **Skill 知识库**，四个 Tab：

| Tab | 用途 |
|-----|------|
| 文档 | 渲染查看全部 skill 内容，左侧树带最近更新时间 |
| 迭代历史 | git 驱动的知识变更时间线（全局或单文件） |
| 版本对比 | 任意两个 commit 的知识 diff |
| 健康巡检 | 一键校验：结构完整/索引同步/代码锚点/死链，红橙绿报告 |

## 三、维护者备忘

- 校验器与后台 API 是**同一套规则**的两处实现：`skills/scripts/validate.mjs` 与 `server/src/lib/skill-validate.ts`，改规则两处同步
- `new-skill.sh` 会提醒更新 AGENTS.md 索引；索引缺失会被校验器报错（`[索引]` 前缀）
- 锚点写法约定：反引号内代码路径（兼容仓库根/admin-web/server 三个基准）+ `#符号名`；详见 `skills/scripts/validate.mjs` 头注释
- 跳过 hook：`git commit --no-verify`（仅限确认无误的紧急场景）

## 反向校验锚点

- 本 skill 引用的脚本/代码：`skills/scripts/validate.mjs`、`skills/scripts/new-skill.sh`、`server/src/lib/skill-validate.ts`、`.githooks/pre-commit`

## 约束关联

本 skill 是流程手册, 不直接涉及不可变约束; 但维护流程本身受 C-10 (schema 纪律) 间接约束。三件套：[_meta/constraints.md](../_meta/constraints.md) / [_meta/glossary.md](../_meta/glossary.md) / [_meta/pitfalls.md](../_meta/pitfalls.md)
