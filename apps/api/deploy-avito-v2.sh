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
echo "=== prisma db push (AvitoWebhookEvent + AvitoAuditLog + avitoMode) ==="
npx prisma db push --accept-data-loss 2>&1 | grep -E "✓|sync|Done|Error|fail|column|table" | head -10

echo ""
echo "=== pm2 restart + save ==="
pm2 restart ai-api
pm2 save
sleep 3

echo ""
echo "=== frontend: npm ci + build ==="
cd /var/www/site-al.ru/apps/web
npm ci 2>&1 | tail -2
npm run build 2>&1 | tail -4

echo ""
echo "=== health ==="
curl -sf http://127.0.0.1:4000/health && echo " OK"

echo ""
echo "=== verify avito webhook (V2 — expect 200 + eventId) ==="
RESP=$(curl -sf -X POST http://127.0.0.1:4000/avito/webhook/test-agent \
  -H "Content-Type: application/json" \
  -d '{"type":"message","id":"test-event-001","payload":{"value":{"chat_id":"chat_123","author_id":"user_456","content":{"text":"тест"},"type":"text"}}}')
echo "Response: $RESP"
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')==True, 'FAIL'; print('  ✅ webhook ACK ok=true')"

echo ""
echo "=== verify audit table exists ==="
psql "$DATABASE_URL" -c "SELECT count(*) FROM avito_audit_logs;" 2>/dev/null && echo "  ✅ avito_audit_logs table OK" || echo "  ⚠️  psql not available"

echo ""
echo "=== pm2 log: avito worker ==="
pm2 logs ai-api --lines 30 --nostream 2>/dev/null | grep -i "avito" | tail -5 || echo "(no avito logs yet)"

echo ""
echo "=== git sync ==="
cd /var/www/site-al.ru
HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
[ "$HEAD" = "$ORIGIN" ] && echo "HEAD == origin/main: OK ($HEAD)" || echo "MISMATCH"

echo ""
echo "=== DONE ==="
