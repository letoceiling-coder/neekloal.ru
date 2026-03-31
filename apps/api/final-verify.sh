#!/bin/bash

echo "=== pwd ==="
cd /var/www/site-al.ru
pwd

echo ""
echo "=== git status: restore deleted tracked files ==="
git restore apps/api/run-chat-test.sh apps/api/test-agent-chat.js 2>/dev/null || true
git status --short

echo ""
echo "=== git pull ==="
git pull origin main 2>&1 | tail -4

echo ""
echo "=== git sync check ==="
HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
echo "HEAD:        $HEAD"
echo "origin/main: $ORIGIN"
[ "$HEAD" = "$ORIGIN" ] && echo "  OK: match" || echo "  FAIL: mismatch"

echo ""
echo "=== npm ci ==="
cd apps/api
npm ci 2>&1 | tail -4

echo ""
echo "=== pm2 restart + save ==="
pm2 restart ai-api
pm2 save
sleep 3

echo ""
echo "=== health localhost ==="
curl -sf http://127.0.0.1:4000/health && echo " OK"

echo ""
echo "=== health https://site-al.ru/api/health ==="
curl -sf https://site-al.ru/api/health && echo " OK"

echo ""
echo "=== pm2 cwd ==="
pm2 describe ai-api | grep cwd

echo ""
echo "=== pm2 count (must=1) ==="
pm2 list | grep ai-api | wc -l

echo ""
echo "=== port 4000 ==="
ss -tulnp | grep 4000

echo ""
echo "=== nginx -t ==="
nginx -t 2>&1 | tail -2

echo ""
echo "=== git status final ==="
cd /var/www/site-al.ru
git status --short

echo ""
echo "=== ALL CHECKS DONE ==="
