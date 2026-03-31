#!/bin/bash
set -e
cd /var/www/site-al.ru/apps/api

echo "=== npm ci ==="
npm ci --prefer-offline 2>&1 | tail -2

echo "=== prisma db push ==="
npx prisma db push --accept-data-loss 2>&1

echo "=== pm2 restart ==="
pm2 restart ai-api
sleep 3

echo "=== health ==="
curl -sf http://127.0.0.1:4000/health && echo " HEALTH_OK"
