#!/bin/bash
set -e
cd /var/www/site-al.ru

echo "=== GIT PULL ==="
git pull origin main

echo ""
echo "=== PM2 RESTART ==="
pm2 restart ai-api --update-env
sleep 5

echo ""
echo "=== REDIS DB1 rl: KEYS BEFORE TEST ==="
redis-cli -n 1 keys "rl:*" 2>/dev/null || echo "(none)"

echo ""
echo "=== GET JWT + ASSISTANT ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findFirst({ where: { platformRole: 'ROOT' } });
  const asst = await prisma.assistant.findFirst({});
  if (!user || !asst) { console.error('no user/asst'); process.exit(1); }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
  console.log('JWT=' + token);
  console.log('ASST=' + asst.id);
  await prisma.\$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
" > /tmp/rl-vars.txt 2>&1

cat /tmp/rl-vars.txt
JWT=$(grep '^JWT=' /tmp/rl-vars.txt | cut -d= -f2-)
ASST=$(grep '^ASST=' /tmp/rl-vars.txt | cut -d= -f2-)

if [ -z "$JWT" ] || [ -z "$ASST" ]; then
  echo "ERROR: could not get JWT or ASST"
  cat /tmp/rl-vars.txt
  exit 1
fi

echo "JWT prefix: ${JWT:0:30}..."
echo "AssistantId: $ASST"

echo ""
echo "=== TEST: 5 rapid requests ==="
for i in 1 2 3 4 5; do
  RESP=$(curl -s -w "\nHTTP:%{http_code}" \
    -X POST http://localhost:4000/chat \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{\"assistantId\":\"$ASST\",\"message\":\"rate limit test $i\"}" \
    --max-time 30)
  STATUS=$(echo "$RESP" | grep "HTTP:" | cut -d: -f2)
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
  echo "  $k = count:$val  TTL:${ttl}s"
done

echo ""
echo "=== PM2 LOGS: rateLimit entries ==="
pm2 logs ai-api --lines 60 --nostream 2>/dev/null | grep -E "\[rateLimit" | head -20 || echo "(none found)"

echo ""
echo "=== CHECK: no Prisma RateLimitState ==="
pm2 logs ai-api --lines 60 --nostream 2>/dev/null | grep -i "RateLimitState" && echo "WARNING: Prisma still called" || echo "OK — RateLimitState not in logs"

echo ""
echo "=== DONE ==="
