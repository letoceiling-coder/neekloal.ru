#!/usr/bin/env bash
set -euo pipefail

API="https://site-al.ru/api"

echo "=== PROOF V2: memory (conversation.context) + knowledge intent routing ==="

cd /var/www/site-al.ru/apps/api
set -a
source .env
set +a

PGURI="${DATABASE_URL%%\?*}"

echo "=== STEP 1: get JWT + assistantId + create conversation ==="
PACK="$(node -e "
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
(async () => {
  const prisma = new PrismaClient();
  const m = await prisma.membership.findFirst({ where: { deletedAt: null }, select: { organizationId: true, userId: true } });
  if (!m) throw new Error('no membership');
  const a = await prisma.assistant.findFirst({ where: { organizationId: m.organizationId, deletedAt: null }, select: { id: true } });
  if (!a) throw new Error('no assistant');
  const token = jwt.sign({ userId: m.userId, organizationId: m.organizationId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  console.log(JSON.stringify({ token, assistantId: a.id }));
})().catch(e => { console.error(e?.message || String(e)); process.exit(1); });
")"

TOKEN="$(echo "$PACK" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
ASSISTANT_ID="$(echo "$PACK" | python3 -c 'import json,sys; print(json.load(sys.stdin)["assistantId"])')"
echo \"assistantId=$ASSISTANT_ID\"

CONV_ID="$(curl -sS -X POST \"$API/conversations\" \
  -H \"Authorization: Bearer $TOKEN\" \
  -H \"Content-Type: application/json\" \
  -d \"{\\\"assistantId\\\":\\\"$ASSISTANT_ID\\\"}\" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')"
echo \"conversationId=$CONV_ID\"

echo
echo \"=== STEP 2: chat with budget + landing ===\"
CHAT1="$(curl -sS -X POST \"$API/chat\" \
  -H \"Authorization: Bearer $TOKEN\" \
  -H \"Content-Type: application/json\" \
  -d \"{\\\"assistantId\\\":\\\"$ASSISTANT_ID\\\",\\\"conversationId\\\":\\\"$CONV_ID\\\",\\\"message\\\":\\\"У нас бюджет 30000. Хочу лендинг.\\\"}\" | head -c 2000 || true)"
echo \"chat1 response: $(echo \"$CHAT1\" | head -c 200 | tr -d '\\n')...\"

echo
echo \"=== STEP 3: verify conversations.context persisted ===\"
DB_ROW=\"$(psql \"$PGURI\" -t -c \"SELECT sales_stage, context::text FROM conversations WHERE id='${CONV_ID}' LIMIT 1;\" 2>/dev/null | tr -d '\\n' || true)\"
echo \"DB row (sales_stage, context): $DB_ROW\"

echo
echo \"=== STEP 4: create pricing knowledge item (knowledge.intent) ===\"
KNOW_RESP="$(curl -sS -X POST \"$API/knowledge\" \
  -H \"Authorization: Bearer $TOKEN\" \
  -H \"Content-Type: application/json\" \
  -d \"{\\\"assistantId\\\":\\\"$ASSISTANT_ID\\\",\\\"content\\\":\\\"Цена 12345 руб. Пакет включает консультацию и сопровождение.\\\"}\" | python3 -c \"import json,sys; print(json.load(sys.stdin).get('id',''))\")"
echo \"knowledgeId=$KNOW_RESP\"

echo
echo \"=== STEP 5: chat 'сколько стоит' and check pm2 logs ===\"
CHAT2="$(curl -sS -X POST \"$API/chat\" \
  -H \"Authorization: Bearer $TOKEN\" \
  -H \"Content-Type: application/json\" \
  -d \"{\\\"assistantId\\\":\\\"$ASSISTANT_ID\\\",\\\"conversationId\\\":\\\"$CONV_ID\\\",\\\"message\\\":\\\"сколько стоит\\\"}\" | head -c 2000 || true)"
echo \"chat2 response: $(echo \"$CHAT2\" | head -c 200 | tr -d '\\n')...\"

echo
echo \"=== STEP 6: pm2 logs filter (hybridSales) ===\"
pm2 logs ai-api --nostream --lines 350 2>&1 | node -e "
const fs = require('fs');
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const lines = input.split(/\\r?\\n/).filter(Boolean);
  const needles = ['chat hybrid sales','chat/stream hybrid sales','hybridSales'];
  const out = lines.filter(l => needles.some(n => l.toLowerCase().includes(n.toLowerCase())));
  process.stdout.write(out.slice(-25).join('\\n'));
});
"

echo
echo \"=== DONE ===\"

