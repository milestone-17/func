#!/usr/bin/env bash
# 新建 skill 脚手架 v2: 含约束关联/术语/踩坑三要素模板
# 用法: ./new-skill.sh <name> "描述"
set -e
NAME="$1"
DESC="${2:-TODO: 一句话描述该 skill 覆盖的领域}"
[ -z "$NAME" ] { echo "用法: new-skill.sh <skill-name> [描述]"; exit 1; }

DIR="$(dirname "$0")/.."
SKILL_DIR="$DIR/$NAME"
[ -e "$SKILL_DIR" ] { echo "skill 已存在: $SKILL_DIR"; exit 1; }

mkdir -p "$SKILL_DIR/references"

cat > "$SKILL_DIR/SKILL.md" <<EOF
---
name: $NAME
description: "$DESC"
globs: []
alwaysApply: false
---

# $NAME（L2 核心知识）

## 核心要点

- TODO

## 代码地图（L2→L3 索引）

- 细节 → [references/xxx.md](./references/xxx.md)

## 反向校验锚点

- TODO: 关键代码文件 \`src/...\`，改动时需复核本文档

## 约束关联

本 skill 涉及的不可变约束（详见 [_meta/constraints.md](../_meta/constraints.md)）：C-xx
术语表：[_meta/glossary.md](../_meta/glossary.md) · 踩坑记录：[_meta/pitfalls.md](../_meta/pitfalls.md)

> 把 C-xx 替换为本模块真实的约束 ID；新约束先在 constraints.md 登记。
EOF

cat > "$SKILL_DIR/references/overview.md" <<EOF
# $NAME 细节（L3）

TODO: 按需加载的深度内容
EOF

echo "已创建 skills/$NAME/（含三要素模板）"
echo "后续步骤:"
echo "  1. 填写 SKILL.md（含约束关联的 C-xx 替换）"
echo "  2. AGENTS.md 索引表加一行: | $NAME | $DESC | [SKILL.md](./$NAME/SKILL.md) |"
echo "  3. node skills/scripts/validate.mjs 校验后再提交"
