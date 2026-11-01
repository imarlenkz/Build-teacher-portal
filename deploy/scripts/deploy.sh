#!/usr/bin/env bash
# Жаңарту: код → сборка → қайта іске қосу (миграциялар backend іске қосылғанда автоматты орындалады).
set -euo pipefail
cd "$(dirname "$0")/../.."
git pull --ff-only
./deploy/scripts/backup.sh
docker compose build --pull
docker compose up -d
docker compose ps
