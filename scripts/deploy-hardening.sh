#!/usr/bin/env bash
set -euo pipefail
BASE=/var/www/site-al.ru
API=$BASE/apps/api
WEB=$BASE/apps/web

echo "=== git pull ==="
cd $BASE
git pull origin main

echo "=== api: npm ci + migrate + restart ==="
cd $API
npm ci --prefer-offline
npx prisma migrate deploy
pm2 restart ai-api
pm2 save --force

echo "=== web: npm ci + build ==="
cd $WEB
npm ci --prefer-offline
npm run build

echo "=== nginx ==="
nginx -t
systemctl reload nginx

echo "=== DONE ==="
