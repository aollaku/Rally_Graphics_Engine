#!/bin/sh
set -eu
mkdir -p /backups
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
while true; do
  TS=$(date +%Y%m%d_%H%M%S)
  FILE="/backups/rally_graphics_${TS}.sql.gz"
  echo "Creating backup $FILE"
  if pg_dump "$DATABASE_URL" | gzip > "$FILE"; then
    echo "Backup complete: $FILE"
  else
    echo "Backup failed"
    rm -f "$FILE"
  fi
  find /backups -type f -name '*.sql.gz' -mtime +"$RETENTION_DAYS" -delete || true
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
