#!/usr/bin/env bash
# 冒烟自检: skill 级可执行验证 (AI-Meeting 式 scripts/)
# 用法: bash skills/scripts/smoke.sh
set -e
cd "$(dirname "$0")/../.."

echo "[1/2] 防腐校验..."
node skills/scripts/validate.mjs

echo "[2/2] 服务探活..."
code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true)
if [ "$code" = "200" ]; then echo "health: 200 OK"; else echo "health: $code (服务未运行? 构建部署后重试)"; fi

echo "SMOKE PASS"
