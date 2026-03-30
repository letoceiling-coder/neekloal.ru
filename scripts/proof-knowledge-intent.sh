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
  const userId = m ? m.userId : a.organizationId;
  const tok = jwt.sign(
    { userId, organizationId: a.organizationId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log(tok + '|' + a.id + '|' + a.organizationId);
  await prisma.\$disconnect();
})();
")
JWT=$(echo "$TOKEN"  | cut -d'|' -f1)
AID=$(echo "$TOKEN"  | cut -d'|' -f2)
ORG=$(echo "$TOKEN"  | cut -d'|' -f3)

echo "=== PRIORITY 2: filename-based intent ==="
echo "Prices info: сайт стоит 10000 рублей"      > /tmp/pricing.txt
echo "Handling objections: дорого, но качество"   > /tmp/objections.txt
echo "General company info"                       > /tmp/company_info.txt

RESP=$(curl -s \
  -H "Authorization: Bearer $JWT" \
  -F "assistantId=$AID" \
  -F "files[]=@/tmp/pricing.txt" \
  -F "files[]=@/tmp/objections.txt" \
  -F "files[]=@/tmp/company_info.txt" \
  http://localhost:4000/knowledge/upload)

echo "Upload response:"
echo "$RESP" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
d.items.forEach(i => console.log('  item:', i.sourceName, '→ saved'));
if (d.errors.length) d.errors.forEach(e => console.log('  ERROR:', e.sourceName, e.error));
"

# Extract IDs from DB and check intent field
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.knowledge.findMany({
    where: { organizationId: '$ORG', sourceName: { in: ['pricing.txt','objections.txt','company_info.txt'] } },
    select: { sourceName: true, intent: true },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log('\nDB intent check:');
  rows.forEach(r => console.log('  ', r.sourceName, '→ intent:', r.intent));

  // Assertions
  const ok = [];
  const fail = [];
  const pricing = rows.find(r => r.sourceName === 'pricing.txt');
  const obj     = rows.find(r => r.sourceName === 'objections.txt');
  const company = rows.find(r => r.sourceName === 'company_info.txt');

  if (pricing?.intent === 'pricing')            ok.push('pricing.txt → pricing ✓');
  else fail.push('pricing.txt intent WRONG: ' + pricing?.intent);

  if (obj?.intent === 'objection')              ok.push('objections.txt → objection ✓');
  else fail.push('objections.txt intent WRONG: ' + obj?.intent);

  if (company?.intent === null)                 ok.push('company_info.txt → null ✓');
  else fail.push('company_info.txt intent WRONG: ' + company?.intent);

  console.log('\nResults:');
  ok.forEach(m => console.log(' ✓', m));
  fail.forEach(m => console.log(' ✗', m));
  if (fail.length) process.exitCode = 1;
  await prisma.\$disconnect();
})();
"

echo ""
echo "=== PRIORITY 1: explicit body.intent override (text endpoint) ==="
RESP2=$(curl -s -w "\nHTTP:%{http_code}" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$AID\",\"content\":\"просто текст без ключевых слов\",\"intent\":\"close\"}" \
  http://localhost:4000/knowledge)
HTTP2=$(echo "$RESP2" | grep "HTTP:" | sed 's/HTTP://')
echo "HTTP: $HTTP2"
ID2=$(echo "$RESP2" | grep -v "HTTP:" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log(d.id || '');
")
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const r = await prisma.knowledge.findUnique({ where: { id: '$ID2' }, select: { intent: true, content: true } });
  console.log('  body.intent=close → DB intent:', r?.intent, r?.intent === 'close' ? '✓' : '✗ FAIL');
  await prisma.\$disconnect();
})();
"

echo ""
echo "PROOF COMPLETE"
