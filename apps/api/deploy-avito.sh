#!/bin/bash
set -e
cd /var/www/site-al.ru

echo "=== git pull ==="
git pull origin main 2>&1 | tail -6

echo ""
echo "=== backend: npm ci ==="
cd apps/api
npm ci 2>&1 | tail -3

echo ""
echo "=== prisma db push (add source/externalId/autoReply columns) ==="
npx prisma db push --accept-data-loss 2>&1 | grep -E "✓|sync|Done|Error|fail" | tail -5

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
echo "=== health ==="
curl -sf http://127.0.0.1:4000/health && echo " OK"

echo ""
echo "=== verify avito route exists ==="
# Should return 404 agent not found (route is registered), not 404 route not found
CODE=$(curl -sf -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:4000/avito/webhook/non-existent-id -H "Content-Type: application/json" -d '{"type":"test"}')
echo "POST /avito/webhook/non-existent-id → HTTP $CODE (expected 200 - ACK)"

echo ""
echo "=== git sync ==="
cd /var/www/site-al.ru
HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
[ "$HEAD" = "$ORIGIN" ] && echo "HEAD == origin/main: OK ($HEAD)" || echo "MISMATCH: HEAD=$HEAD ORIGIN=$ORIGIN"

echo ""
echo "=== pm2 logs (avito lines) ==="
pm2 logs ai-api --lines 20 --nostream 2>/dev/null | grep -i "avito\|health" | tail -5 || echo "(no avito logs yet)"

echo ""
echo "=== DONE ==="
