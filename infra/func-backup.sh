#!/bin/bash
# func 数据库每日备份: 本地保留 30 天 + 异地目录(挂载/跨盘可后期替换)
set -euo pipefail

PGUSER=func_dev
PGPASSWORD=funcdev2026
DB=$(grep -o '/[a-zA-Z_]*$\|/[a-zA-Z_]*\?' /home/ubuntu/workspace/func/server/.env | tail -1)
# 从 DATABASE_URL 提取库名 (最后一个 / 后的段)
DB=$(grep '^DATABASE_URL' /home/ubuntu/workspace/func/server/.env | sed 's|.*/||; s|?.*||')
BACKUP_DIR=/home/ubuntu/backups/func-db
OFFSITE_DIR=/home/ubuntu/backups/offsite
KEEP_DAYS=30
STAMP=$(date +%Y-%m-%d_%H%M)

mkdir -p "$BACKUP_DIR" "$OFFSITE_DIR"

FILE="$BACKUP_DIR/func_$STAMP.sql.gz"
PGPASSWORD="$PGPASSWORD" pg_dump -h 127.0.0.1 -U "$PGUSER" -d "$DB" --no-owner | gzip > "$FILE"

# 校验非空 (gzip 文件 >200B 才算有效, 空库 dump 也约 1-2KB)
SIZE=$(stat -c%s "$FILE")
if [ "$SIZE" -lt 200 ]; then
  echo "[$(date)] 备份异常小 (${SIZE}B), 保留文件供排查: $FILE" >> /home/ubuntu/backups/backup.log
  exit 1
fi

# 异地副本 (同机另一目录占位; 后续可换成 rclone/coscmd 同步到 COS)
cp "$FILE" "$OFFSITE_DIR/"

# 清理过期
find "$BACKUP_DIR" -name 'func_*.sql.gz' -mtime +$KEEP_DAYS -delete
find "$OFFSITE_DIR" -name 'func_*.sql.gz' -mtime +$KEEP_DAYS -delete

echo "[$(date)] OK $FILE (${SIZE}B)" >> /home/ubuntu/backups/backup.log
