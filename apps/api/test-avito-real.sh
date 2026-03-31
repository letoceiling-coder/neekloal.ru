#!/bin/bash
# Test with a real agent UUID from the database
cd /var/www/site-al.ru/apps/api

echo "=== Getting real agent UUID ==="
AGENT_ID=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.agent.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }).then(a => {
  if (!a) { console.log('NO_AGENT'); process.exit(1); }
  console.log(a.id);
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null)

if [ "$AGENT_ID" = "NO_AGENT" ] || [ -z "$AGENT_ID" ]; then
  echo "  ⚠️  No agents in DB — skipping real agent test"
  exit 0
fi
echo "  Agent ID: $AGENT_ID"

echo ""
echo "=== Sending test message ==="
EVENT_ID="real-test-$(date +%s)"
RESP=$(curl -sf -X POST "http://127.0.0.1:4000/avito/webhook/${AGENT_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"message\",\"id\":\"${EVENT_ID}\",\"payload\":{\"value\":{\"chat_id\":\"avito_real_chat\",\"author_id\":\"avito_user_999\",\"content\":{\"text\":\"Добрый день! Сколько стоит?\"},\"type\":\"text\"}}}")
echo "Response: $RESP"
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')==True; print('  ✅ ACK ok=true')"

echo ""
echo "=== Sleeping 6s for full pipeline ==="
sleep 6

echo ""
echo "=== PM2 pipeline logs ==="
pm2 logs ai-api --lines 80 --nostream 2>/dev/null | grep -E "\[avito" | grep -v "test-agent-123" | tail -20

echo ""
echo "=== AuditLog ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.avitoAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 3 }).then(rows => {
  console.log('audit rows:', rows.length);
  rows.forEach(r => console.log(
    '  agentId=' + r.agentId.slice(0,8) + '... chatId=' + r.chatId +
    ' decision=' + r.decision + ' success=' + r.success + ' ms=' + r.durationMs
  ));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
"

echo ""
echo "=== CRM Leads (source=avito) ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.lead.findMany({ where: { source: 'avito' }, orderBy: { createdAt: 'desc' }, take: 3 }).then(rows => {
  console.log('avito leads:', rows.length);
  rows.forEach(r => console.log('  id=' + r.id + ' name=' + r.name + ' status=' + r.status));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
"

echo ""
echo "=== DONE ==="
