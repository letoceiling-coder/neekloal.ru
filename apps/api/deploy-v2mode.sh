#!/bin/bash
set -e
cd /var/www/site-al.ru

echo "=== git pull ==="
git pull origin main 2>&1 | tail -5

echo ""
echo "=== backend: npm ci ==="
cd apps/api
npm ci 2>&1 | tail -3

echo ""
echo "=== pm2 restart + save ==="
pm2 restart ai-api
pm2 save
sleep 3

echo ""
echo "=== frontend: npm ci + build ==="
cd /var/www/site-al.ru/apps/web
npm ci 2>&1 | tail -3
npm run build 2>&1 | tail -5

echo ""
echo "=== dist verify ==="
ls -lh /var/www/site-al.ru/apps/web/dist/

echo ""
echo "=== health ==="
curl -sf http://127.0.0.1:4000/health && echo " OK"

echo ""
echo "=== git sync ==="
cd /var/www/site-al.ru
HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
[ "$HEAD" = "$ORIGIN" ] && echo "HEAD == origin/main: OK ($HEAD)" || echo "MISMATCH"

echo ""
echo "=== DONE ==="
