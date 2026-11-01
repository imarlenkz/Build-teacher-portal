#!/usr/bin/env bash
# Дерекқорды резервтік көшірмеден қалпына келтіру.
# Қолдану:
#   ./deploy/scripts/restore.sh backups/ustaz_20261101_033000.dump
#   ./deploy/scripts/restore.sh --volume ustaz_auto_20261101_020000.dump   # backend жасаған көшірме (backups томынан)
# НАЗАР: ағымдағы деректер толығымен ауыстырылады. Алдымен қауіпсіздік үшін ағымдағы күйдің көшірмесі жасалады.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "${1:-}" = "--volume" ]; then
  NAME="${2:?Файл атауын көрсетіңіз}"
  SRC="$(mktemp)"
  docker compose cp "backend:/backups/$NAME" "$SRC"
else
  SRC="${1:?Көшірме файлын көрсетіңіз}"
fi
[ -s "$SRC" ] || { echo "Файл табылмады немесе бос: $SRC"; exit 1; }
docker compose exec -T postgres pg_restore --list < "$SRC" >/dev/null || { echo "Файл pg_dump custom форматында емес"; exit 1; }

read -r -p "Дерекқор толығымен ауыстырылады. Жалғастыру үшін RESTORE деп жазыңыз: " ok
[ "$ok" = "RESTORE" ] || { echo "Бас тартылды"; exit 1; }

echo "» Қауіпсіздік көшірмесі"
./deploy/scripts/backup.sh
echo "» backend тоқтатылады"
docker compose stop backend
echo "» Қалпына келтіру"
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction' < "$SRC"
echo "» Redis кэшін тазалау"
docker compose exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning FLUSHDB' >/dev/null
docker compose start backend
echo "✓ Қалпына келтірілді"
