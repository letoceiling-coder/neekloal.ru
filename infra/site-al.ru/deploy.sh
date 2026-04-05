#!/bin/bash
# SSOT: копия для сервера — /var/www/site-al.ru/deploy.sh
# chmod +x /var/www/site-al.ru/deploy.sh
# Запуск на MAIN SERVER из корня: /var/www/site-al.ru/deploy.sh

set -euo pipefail

ROOT="/var/www/site-al.ru"

log() {
  echo "$(date -Iseconds) [deploy] $*"
}

log "======== START DEPLOY ========"

cd "${ROOT}"

if [ "$(pwd -P)" != "${ROOT}" ]; then
  log "FATAL: pwd is not ${ROOT}, got: $(pwd -P)"
  exit 1
fi

log "ROOT OK: ${ROOT}"

log "git fetch origin && reset --hard origin/main"
git fetch origin
git reset --hard origin/main

log "API: npm ci"
cd "${ROOT}/apps/api"
npm ci

log "prisma migrate deploy"
npx prisma migrate deploy

log "prisma generate"
npx prisma generate

log "PM2 ai-api"
if pm2 describe ai-api >/dev/null 2>&1; then
  log "ai-api exists"
else
  log "starting ai-api from src/app.js"
  pm2 start src/app.js --name ai-api
fi
pm2 restart ai-api
if pm2 describe image-worker >/dev/null 2>&1; then
  log "PM2 image-worker"
  pm2 restart image-worker
fi
if pm2 describe video-worker >/dev/null 2>&1; then
  log "PM2 video-worker"
  pm2 restart video-worker
fi
pm2 save

log "Frontend: npm ci + build"
cd "${ROOT}/apps/web"
npm ci
npm run build

log "VERIFY dist"
ls -la dist
if [ ! -f dist/index.html ]; then
  log "FATAL: dist/index.html missing"
  exit 1
fi

log "nginx test + reload"
nginx -t
systemctl reload nginx

log "FINAL curl checks"
curl -sS "https://site-al.ru/api/health" || true
echo ""
curl -sS "https://site-al.ru" | head -n 3 || true
echo ""

log "======== DEPLOY DONE ========"
