#!/usr/bin/env bash
# Қолмен резервтік көшірме (cron-нан да шақыруға болады). Көшірме ./backups/ ішіне сақталады.
# Қосымша: backend өзі де күн сайын 02:00-де /backups томына көшірме жасайды (Баптаулар → Резервтік көшірмелер).
#   crontab мысалы:  30 3 * * *  /opt/ustaz/deploy/scripts/backup.sh >> /var/log/ustaz-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/../.."
KEEP_DAYS="${KEEP_DAYS:-30}"
mkdir -p backups
FILE="backups/ustaz_$(date +%Y%m%d_%H%M%S).dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner' > "$FILE"
# Бос немесе бүлінген файлды тексеру
docker compose exec -T postgres pg_restore --list < "$FILE" >/dev/null
echo "✓ $(date '+%F %T') $FILE ($(du -h "$FILE" | cut -f1))"
find backups -name 'ustaz_*.dump' -mtime +"$KEEP_DAYS" -delete
