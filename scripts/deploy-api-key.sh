#!/usr/bin/env bash
set -euo pipefail
cd /var/www/site-al.ru

echo "=== git pull ==="
git pull origin main

echo "=== npm ci ==="
cd apps/api
npm ci --omit=dev

echo "=== prisma migrate deploy ==="
npx prisma migrate deploy

echo "=== pm2 restart ==="
pm2 restart ai-api
pm2 save

echo "=== wait 3s ==="
sleep 3

echo "=== health check ==="
curl -sS http://127.0.0.1:4000/health
echo ""
