#!/bin/sh
# Контейнер іске қосылғанда: миграциялар → (бірінші рет) бастапқы деректер → сервер.
set -e
echo "[ustaz] prisma migrate deploy"
npx prisma migrate deploy
if [ "${RUN_SEED:-true}" = "true" ]; then
  # Seed идемпотентті: рөлдер, анықтамалықтар және бірінші admin тек жоқ болса жасалады.
  echo "[ustaz] seed (idempotent)"
  node dist/prisma/seed.js
fi
exec "$@"
