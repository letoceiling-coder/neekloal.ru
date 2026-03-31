#!/bin/bash
set -e
cd /var/www/site-al.ru

echo "=== git pull ==="
git pull origin main 2>&1 | tail -5

echo "=== prisma db push (add agent.model column) ==="
cd apps/api
npx prisma db push --accept-data-loss 2>&1 | tail -8

echo "=== pm2 restart ==="
pm2 restart ai-api
sleep 3

echo "=== health ==="
curl -sf http://127.0.0.1:4000/health && echo " HEALTH_OK"

echo "=== GET /models format ==="
TOK=$(node tok.js 2>/dev/null | tail -1)
curl -sf -H "Authorization: Bearer $TOK" http://127.0.0.1:4000/models | head -c 300
echo ""
