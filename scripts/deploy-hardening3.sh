#!/usr/bin/env bash
set -euo pipefail
BASE=/var/www/site-al.ru
API=$BASE/apps/api
WEB=$BASE/apps/web

echo "=== git pull ==="
cd $BASE && git pull origin main

echo "=== api: npm install + prisma generate + restart ==="
cd $API
npm install --prefer-offline
npx prisma generate
pm2 restart ai-api
pm2 save --force

echo "=== DONE ==="
