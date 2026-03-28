#!/usr/bin/env bash
# Разместить на сервере: /var/www/site-al.ru/deploy.sh
# chmod +x /var/www/site-al.ru/deploy.sh

set -euo pipefail

PROJECT_ROOT="/var/www/site-al.ru"
LOG_PREFIX="[deploy]"

log() {
  echo "$(date -Iseconds) ${LOG_PREFIX} $*"
}

log "======== START DEPLOY ========"

cd "${PROJECT_ROOT}"
log "pwd: $(pwd)"

log "git pull origin main"
git pull origin main

log "API: npm install"
cd "${PROJECT_ROOT}/apps/api"
npm install

log "prisma migrate deploy"
npx prisma migrate deploy

log "prisma generate"
npx prisma generate

log "pm2 restart ai-api (or start)"
if pm2 describe ai-api >/dev/null 2>&1; then
  pm2 restart ai-api
else
  log "ai-api not in pm2 — starting from server.js"
  cd "${PROJECT_ROOT}/apps/api"
  pm2 start server.js --name ai-api --cwd "${PROJECT_ROOT}/apps/api"
fi

log "Frontend: npm install + build"
cd "${PROJECT_ROOT}/apps/web"
npm install
npm run build

log "nginx config test"
sudo nginx -t

log "nginx reload"
sudo systemctl reload nginx

log "======== DEPLOY DONE ========"
