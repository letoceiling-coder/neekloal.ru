#!/usr/bin/env bash
set -euo pipefail

API="https://site-al.ru/api"

cd /var/www/site-al.ru/apps/api
set -a
source .env
set +a

echo "=== PROOF: generate JWT + assistantId ==="
OUT="$(node -e "
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
(async () => {
  const prisma = new PrismaClient();
  const m = await prisma.membership.findFirst({ where: { deletedAt: null }, select: { organizationId: true, userId: true } });
  if (!m) throw new Error('no membership');
  const a = await prisma.assistant.findFirst({ where: { organizationId: m.organizationId, deletedAt: null }, select: { id: true } });
  if (!a) throw new Error('no assistant');
  const token = jwt.sign({ userId: m.userId, organizationId: m.organizationId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  console.log(JSON.stringify({ assistantId: a.id, token }));
})().catch(e => { console.error(e?.message || String(e)); process.exit(1); });
")"

ASSISTANT_ID="$(node -e "console.log(JSON.parse(process.argv[1]).assistantId)" "$OUT")"
TOKEN="$(node -e "console.log(JSON.parse(process.argv[1]).token)" "$OUT")"

echo "assistantId: ${ASSISTANT_ID}"

echo ""
echo "=== PROOF 1: /chat detects intent=pricing ==="
RESP="$(curl -sS -X POST "$API/chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASSISTANT_ID\",\"message\":\"сколько стоит базовый тариф?\"}" \
  || true)"
echo "chat response (truncated): $(echo "$RESP" | head -c 260)"

echo ""
echo "=== PROOF 2: pm2 logs include hybridSales meta ==="
pm2 logs ai-api --nostream --lines 250 2>&1 | node -e "
const fs = require('fs');
const input = fs.readFileSync(0, 'utf8');
const lines = input.split(/\\r?\\n/);
const needles = [
  'chat hybrid sales',
  'hybridSales',
  'intent',
  'stage',
  'knowledgeSource',
];
const out = lines.filter((l) => needles.some((n) => l.toLowerCase().includes(n.toLowerCase())));
process.stdout.write(out.slice(-30).join('\\n'));
" || true

echo ""
echo "=== DONE ==="

