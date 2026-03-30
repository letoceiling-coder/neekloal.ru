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
  if (!a) { console.error('no assistant'); process.exit(1); }
  // get the owner user of the organization
  const membership = await prisma.membership.findFirst({
    where: { organizationId: a.organizationId, deletedAt: null, role: 'OWNER' },
    select: { userId: true }
  });
  const userId = membership ? membership.userId : a.organizationId;
  const tok = jwt.sign(
    { userId, organizationId: a.organizationId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log(tok + '|' + a.id);
  await prisma.\$disconnect();
})();
")
JWT=$(echo "$TOKEN" | cut -d'|' -f1)
AID=$(echo "$TOKEN" | cut -d'|' -f2)
echo "JWT obtained, assistantId=$AID"

# 5 small test files
echo "Test file content 1: pricing info цена 1000 рублей" > /tmp/tf1.txt
echo "Test file content 2: objection handling дорого но качество" > /tmp/tf2.txt
echo "Test file content 3: qualification хочу сайт лендинг" > /tmp/tf3.txt
echo "Test file content 4: general info about company" > /tmp/tf4.txt
echo "Test file content 5: contact information for close" > /tmp/tf5.txt

echo "--- Uploading 5 files ---"
RESP=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  -H "Authorization: Bearer $JWT" \
  -F "assistantId=$AID" \
  -F "files[]=@/tmp/tf1.txt" \
  -F "files[]=@/tmp/tf2.txt" \
  -F "files[]=@/tmp/tf3.txt" \
  -F "files[]=@/tmp/tf4.txt" \
  -F "files[]=@/tmp/tf5.txt" \
  http://localhost:4000/knowledge/upload)

HTTP_STATUS=$(echo "$RESP" | grep "__HTTP_STATUS__" | sed 's/__HTTP_STATUS__//')
BODY=$(echo "$RESP" | grep -v "__HTTP_STATUS__")

echo "HTTP status: $HTTP_STATUS"
echo "Response body:"
echo "$BODY" | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(chunks.join(''));
    console.log('items count:', j.items ? j.items.length : 'N/A');
    console.log('errors count:', j.errors ? j.errors.length : 'N/A');
    if (j.items) j.items.forEach(i => console.log('  item:', i.sourceName, 'status:', i.status));
    if (j.errors && j.errors.length) j.errors.forEach(e => console.log('  error:', e.sourceName, e.error));
  } catch(err) {
    console.log('raw:', chunks.join(''));
  }
});
"

echo ""
echo "--- Last 20 pm2 logs with [upload] ---"
pm2 logs ai-api --nostream --lines 100 2>&1 | grep "\[upload\]" | tail -20

echo ""
echo "PROOF COMPLETE"
