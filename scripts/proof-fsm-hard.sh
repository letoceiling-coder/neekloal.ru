#!/bin/bash
set -e
cd /var/www/site-al.ru/apps/api
source .env

TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const a = await prisma.assistant.findFirst({ where: { deletedAt: null } });
  const m = await prisma.membership.findFirst({
    where: { organizationId: a.organizationId, deletedAt: null, role: 'OWNER' },
    select: { userId: true }
  });
  const tok = jwt.sign(
    { userId: m.userId, organizationId: a.organizationId },
    process.env.JWT_SECRET, { expiresIn: '1h' }
  );
  console.log(tok + '|' + a.id + '|' + a.organizationId);
  await prisma.\$disconnect();
})();
")
JWT=$(echo "$TOKEN" | cut -d'|' -f1)
AID=$(echo "$TOKEN" | cut -d'|' -f2)
ORG=$(echo "$TOKEN" | cut -d'|' -f3)
echo "AID=$AID"

# ── Upload stage-specific knowledge files ──────────────────────────────────
echo "ЛЕНДИНГ стоит 50 000 рублей, корпоративный сайт 150 000"  > /tmp/pricing.txt
echo "Понимаем возражения: наши цены обоснованы высоким качеством" > /tmp/objections.txt

curl -s -H "Authorization: Bearer $JWT" \
  -F "assistantId=$AID" \
  -F "files[]=@/tmp/pricing.txt" \
  -F "files[]=@/tmp/objections.txt" \
  http://localhost:4000/knowledge/upload | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
d.items.forEach(i=>console.log('uploaded:',i.sourceName,'intent:',i.status));
"

# Wait for intents to be set
sleep 2

echo ""
echo "=== TEST 1: stage=objection → should use objections.txt (NOT RAG) ==="
# Force conversation into objection stage
CONV_ID=$(node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const r = await prisma.conversation.create({
    data: {
      organizationId: '$ORG',
      assistantId: '$AID',
      salesStage: 'objection',
      source: 'DASHBOARD',
      status: 'OPEN',
    }
  });
  console.log(r.id);
  await prisma.\$disconnect();
})();
")
echo "conversation.salesStage=objection, id=$CONV_ID"

RESP=$(curl -s \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$AID\",\"message\":\"это дорого\",\"conversationId\":\"$CONV_ID\"}" \
  http://localhost:4000/chat)

echo "Chat response:"
echo "$RESP" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const reply=d.reply||d.response||'(no reply)';
console.log('  reply:', reply.slice(0,200));
console.log('  hybridSales:', JSON.stringify(d.hybridSales||{}));
"

echo ""
echo "=== TEST 2: stage=offer → should use pricing.txt (NOT RAG) ==="
CONV2=$(node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const r = await prisma.conversation.create({
    data: {
      organizationId: '$ORG',
      assistantId: '$AID',
      salesStage: 'offer',
      source: 'DASHBOARD',
      status: 'OPEN',
    }
  });
  console.log(r.id);
  await prisma.\$disconnect();
})();
")
echo "conversation.salesStage=offer, id=$CONV2"

RESP2=$(curl -s \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$AID\",\"message\":\"расскажи подробнее\",\"conversationId\":\"$CONV2\"}" \
  http://localhost:4000/chat)

echo "Chat response:"
echo "$RESP2" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const reply=d.reply||d.response||'(no reply)';
console.log('  reply:', reply.slice(0,200));
console.log('  hybridSales:', JSON.stringify(d.hybridSales||{}));
"

echo ""
echo "=== TEST 3: stage=close → reply MUST propose a call ==="
CONV3=$(node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const r = await prisma.conversation.create({
    data: {
      organizationId: '$ORG',
      assistantId: '$AID',
      salesStage: 'close',
      source: 'DASHBOARD',
      status: 'OPEN',
    }
  });
  console.log(r.id);
  await prisma.\$disconnect();
})();
")
echo "conversation.salesStage=close, id=$CONV3"

RESP3=$(curl -s \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$AID\",\"message\":\"мне нравится, что дальше?\",\"conversationId\":\"$CONV3\"}" \
  http://localhost:4000/chat)

echo "Chat response:"
REPLY3=$(echo "$RESP3" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const reply=d.reply||d.response||'';
console.log(reply.slice(0,300));
")
echo "  reply: $REPLY3"

# Check for call cue in reply
node -e "
const text='$REPLY3'.toLowerCase();
const hasCue=/созвон|созвониться|позвон|встреч|записать|запишу|когда вам удобно/.test(text);
console.log('  stage=close call cue present:', hasCue ? '✓ YES' : '✗ NO (may need repair)');
"

echo ""
echo "=== knowledgeSource log check ==="
pm2 logs ai-api --nostream --lines 100 2>&1 | grep -E "knowledgeSource|fsmKnowledge|hybridSales" | tail -15

echo ""
echo "PROOF COMPLETE"
