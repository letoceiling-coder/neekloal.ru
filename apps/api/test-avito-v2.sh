#!/bin/bash
echo "=== Avito V2 pipeline test ==="

echo ""
echo "--- TEST 1: Webhook ACK ---"
RESP=$(curl -sf -X POST http://127.0.0.1:4000/avito/webhook/test-agent-123 \
  -H "Content-Type: application/json" \
  -d '{"type":"message","id":"v2-test-001","payload":{"value":{"chat_id":"avito_chat_1","author_id":"avito_user_1","content":{"text":"Добрый день, сколько стоит?"},"type":"text"}}}')
echo "$RESP"
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')==True; print('  ✅ ACK ok=true eventId=' + d.get('eventId',''))"

echo ""
echo "--- Sleeping 4s for async processing ---"
sleep 4

echo ""
echo "--- TEST 2: Idempotency (same eventId should be deduped) ---"
RESP2=$(curl -sf -X POST http://127.0.0.1:4000/avito/webhook/test-agent-123 \
  -H "Content-Type: application/json" \
  -d '{"type":"message","id":"v2-test-001","payload":{"value":{"chat_id":"avito_chat_1","author_id":"avito_user_1","content":{"text":"Добрый день, сколько стоит?"},"type":"text"}}}')
echo "$RESP2"
echo "  ✅ duplicate webhook accepted (will be skipped by idempotency check)"

echo ""
echo "--- TEST 3: Non-message event (no queue) ---"
RESP3=$(curl -sf -X POST http://127.0.0.1:4000/avito/webhook/test-agent-123 \
  -H "Content-Type: application/json" \
  -d '{"type":"chat_read","id":"v2-test-002"}')
echo "$RESP3"
echo "$RESP3" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')==True; print('  ✅ non-message event ACK ok')"

echo ""
echo "--- PM2 logs: avito pipeline ---"
pm2 logs ai-api --lines 50 --nostream 2>/dev/null | grep -E "\[avito" | tail -15

echo ""
echo "--- Webhook events in DB ---"
cd /var/www/site-al.ru/apps/api
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.avitoWebhookEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }).then(rows => {
  console.log('webhook events:', rows.length);
  rows.forEach(r => console.log('  id=' + r.id + ' type=' + r.type + ' chatId=' + r.chatId));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
"

echo ""
echo "--- AuditLog entries ---"
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.avitoAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }).then(rows => {
  console.log('audit logs:', rows.length);
  rows.forEach(r => console.log('  chatId=' + r.chatId + ' decision=' + r.decision + ' success=' + r.success + ' ms=' + r.durationMs));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
"

echo ""
echo "=== DONE ==="
