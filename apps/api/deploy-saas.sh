#!/bin/bash
set -e
cd /var/www/site-al.ru

echo "=== git pull ==="
git pull origin main 2>&1 | tail -5

echo ""
echo "=== backend: npm ci ==="
cd apps/api
npm ci 2>&1 | tail -2

echo ""
echo "=== prisma db push (AvitoAccount + Agent.avitoAccountId) ==="
npx prisma db push --accept-data-loss 2>&1 | grep -E "sync|Done|Error|fail|column|table|alter" | head -10

echo ""
echo "=== prisma generate ==="
npx prisma generate 2>&1 | tail -2

echo ""
echo "=== pm2 restart ==="
pm2 restart ai-api
pm2 save
sleep 3

echo ""
echo "=== frontend build ==="
cd /var/www/site-al.ru/apps/web
npm ci 2>&1 | tail -2
npm run build 2>&1 | tail -4

echo ""
echo "=== health ==="
curl -sf http://127.0.0.1:4000/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('API', d.get('status'))"

echo ""
echo "=== verify: GET /avito/accounts requires auth ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/avito/accounts)
[ "$STATUS" = "401" ] && echo "  ✅ GET /avito/accounts → 401 (auth required)" || echo "  ⚠️  expected 401, got $STATUS"

echo ""
echo "=== verify: POST /avito/accounts returns 401 without auth ==="
STATUS2=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:4000/avito/accounts -H "Content-Type: application/json" -d '{}')
[ "$STATUS2" = "401" ] && echo "  ✅ POST /avito/accounts → 401" || echo "  ⚠️  expected 401, got $STATUS2"

echo ""
echo "=== verify: webhook still works ==="
RESP=$(curl -sf -X POST http://127.0.0.1:4000/avito/webhook/test-agent \
  -H "Content-Type: application/json" \
  -d '{"type":"message","id":"saas-test-001","payload":{"value":{"chat_id":"chat_x","author_id":"user_x","content":{"text":"test"},"type":"text"}}}')
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')==True; print('  ✅ webhook ok=true')"

echo ""
echo "=== pm2 logs: avito (last 5) ==="
pm2 logs ai-api --lines 30 --nostream 2>/dev/null | grep "\[avito" | tail -5

echo ""
echo "=== git sync ==="
cd /var/www/site-al.ru
HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
[ "$HEAD" = "$ORIGIN" ] && echo "HEAD == origin/main OK ($HEAD)" || echo "MISMATCH HEAD=$HEAD ORIGIN=$ORIGIN"

echo ""
echo "=== DONE ==="
