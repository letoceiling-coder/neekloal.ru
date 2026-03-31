#!/bin/bash
cd /var/www/site-al.ru

echo "=== clean untracked test files ==="
rm -f apps/api/test-agent-chat*.js apps/api/run-*.sh apps/api/deploy-*.sh

echo "=== git pull ==="
git pull origin main 2>&1 | tail -5

echo "=== prisma db push ==="
cd apps/api
npx prisma db push --accept-data-loss 2>&1 | grep -v "^warn\|^Running\|^  \[" | tail -5

echo "=== pm2 restart ==="
pm2 restart ai-api
sleep 3

echo "=== health ==="
curl -sf http://127.0.0.1:4000/health && echo " OK"

echo "=== GET /models (new {name} format) ==="
TOK=$(node tok.js 2>/dev/null | tail -1)
curl -sf -H "Authorization: Bearer $TOK" http://127.0.0.1:4000/models

echo ""
echo "=== PM2 logs (last 10 lines) ==="
pm2 logs ai-api --lines 10 --nostream 2>/dev/null | tail -12
