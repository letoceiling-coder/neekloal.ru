#!/bin/bash
set -e
cd /var/www/site-al.ru

echo "=== GIT PULL ==="
git pull origin main

echo ""
echo "=== PM2 RESTART ==="
pm2 restart ai-api --update-env
sleep 4
pm2 list | grep ai-api

echo ""
echo "=== REDIS DB1 KEYS BEFORE TEST ==="
redis-cli -n 1 keys "rl:*" | head -10 || echo "(none yet)"

echo ""
echo "=== VERIFY: GET JWT ==="
JWT=$(node -e "
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findFirst({ where: { platformRole: 'ROOT' } });
  if (!user) { console.error('No ROOT user'); process.exit(1); }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
  console.log(token);
  await prisma.\$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
" 2>/dev/null)
echo "JWT obtained: ${JWT:0:30}..."

echo ""
echo "=== TEST: 5 rapid requests ==="
ASST=$(node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const a = await prisma.assistant.findFirst({});
  if (!a) { console.error('no assistant'); process.exit(1); }
  console.log(a.id);
  await prisma.\$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
" 2>/dev/null)
echo "AssistantId: $ASST"

for i in 1 2 3 4 5; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:4000/chat \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{\"assistantId\":\"$ASST\",\"message\":\"test rl $i\"}")
  echo "Request $i → HTTP $STATUS"
done

echo ""
echo "=== REDIS DB1 rl: KEYS AFTER ==="
redis-cli -n 1 keys "rl:*"

echo ""
echo "=== REDIS KEY VALUES ==="
for k in $(redis-cli -n 1 keys "rl:*"); do
  val=$(redis-cli -n 1 get "$k")
  ttl=$(redis-cli -n 1 ttl "$k")
  echo "$k = $val (TTL: ${ttl}s)"
done

echo ""
echo "=== PM2 LOGS (rateLimit lines) ==="
pm2 logs ai-api --lines 30 --nostream 2>/dev/null | grep -E "rateLimit|RATE|429" | head -20 || true

echo ""
echo "=== CHECK: NO SQL rateLimit queries in logs ==="
pm2 logs ai-api --lines 50 --nostream 2>/dev/null | grep -i "RateLimitState\|rateLimitState" | head -5 && echo "WARNING: Prisma RateLimitState still used" || echo "OK — no Prisma RateLimitState in recent logs"
