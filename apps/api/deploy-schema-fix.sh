#!/bin/bash
set -e
cd /var/www/site-al.ru
git pull origin main 2>&1 | tail -4

echo "=== prisma db push (fix: uuid columns) ==="
cd apps/api
npx prisma db push --accept-data-loss 2>&1 | grep -E "sync|Done|Error|fail|column|alter|drop" | head -10

echo "=== prisma generate ==="
npx prisma generate 2>&1 | tail -3

echo "=== pm2 restart ==="
pm2 restart ai-api
pm2 save
sleep 3

echo "=== pm2 status ==="
pm2 show ai-api 2>/dev/null | grep -E "status|restart" | head -3

echo "=== DONE ==="
