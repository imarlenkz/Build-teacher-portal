#!/usr/bin/env bash
# Бірінші рет Let's Encrypt сертификатын алу.
# Қолдану: ./deploy/scripts/init-letsencrypt.sh admin@mektep.kz
# Алдын ала: .env ішінде DOMAIN толтырылған, DNS A-жазбасы осы серверге бағытталған, 80/443 порттары ашық.
set -euo pipefail
cd "$(dirname "$0")/../.."
EMAIL="${1:?Email көрсетіңіз: init-letsencrypt.sh you@example.kz}"
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"
[ -n "$DOMAIN" ] || { echo "DOMAIN .env ішінде жоқ"; exit 1; }
LIVE="deploy/certs/live/$DOMAIN"

if [ ! -f "$LIVE/fullchain.pem" ]; then
  echo "» nginx іске қосылуы үшін уақытша өздігінен қол қойылған сертификат"
  mkdir -p "$LIVE"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=$DOMAIN" \
    -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem" >/dev/null 2>&1
fi

docker compose up -d nginx
echo "» Уақытша сертификатты жою және Let's Encrypt-тен нақты сертификат сұрау"
rm -rf "deploy/certs/live/$DOMAIN" "deploy/certs/archive/$DOMAIN" "deploy/certs/renewal/$DOMAIN.conf"
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --rsa-key-size 4096 --non-interactive
docker compose exec nginx nginx -s reload
echo "✓ HTTPS дайын: https://$DOMAIN"
