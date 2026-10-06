#!/usr/bin/env bash
# 新建 skill 脚手架: ./new-skill.sh <name> "描述"
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

- TODO: 列出本 skill 依赖的关键代码文件, 改动时需复核本文档
EOF

cat > "$SKILL_DIR/references/overview.md" <<EOF
# $NAME 细节（L3）

TODO: 按需加载的深度内容
EOF

# 提示更新 AGENTS.md 索引
if grep -q "^| Skill" "$DIR/AGENTS.md" 2>/dev/null; then
  echo "已创建 skills/$NAME/"
  echo "提醒: 请在 skills/AGENTS.md 索引表追加一行: | $NAME | $DESC | [SKILL.md](./$NAME/SKILL.md) |"
else
  echo "已创建 skills/$NAME/"
  echo "提醒: 请更新 skills/AGENTS.md 索引"
fi
