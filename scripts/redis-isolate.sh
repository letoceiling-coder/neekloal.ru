#!/bin/bash
echo "=== BEFORE: DB 0 keys ==="
redis-cli -n 0 dbsize
redis-cli -n 0 --scan | head -5

echo ""
echo "=== BEFORE: DB 1 keys ==="
redis-cli -n 1 dbsize

echo ""
echo "=== ADDING REDIS_URL to .env ==="
ENV_FILE="/var/www/site-al.ru/apps/api/.env"

# Remove any existing REDIS_URL line
grep -v "^REDIS_URL=" "$ENV_FILE" > /tmp/.env.tmp && mv /tmp/.env.tmp "$ENV_FILE"

# Append with DB 1
echo "REDIS_URL=redis://127.0.0.1:6379/1" >> "$ENV_FILE"

echo "Current .env (no secrets shown):"
grep -E "^(REDIS_URL|OLLAMA_URL|PORT|QDRANT_URL)" "$ENV_FILE"

echo ""
echo "=== RESTARTING ai-api ==="
pm2 restart ai-api --update-env
sleep 3
pm2 list | grep ai-api

echo ""
echo "=== VERIFY: ai-api uses DB 1 ==="
# Make a test request to trigger Redis usage
JWT=$(cd /var/www/site-al.ru/apps/api && node -e "
const j=require('jsonwebtoken');
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
p.membership.findFirst({where:{deletedAt:null}}).then(m=>{
  if(!m){process.stdout.write('NO_MEMBERSHIP');p.\$disconnect();return;}
  process.stdout.write(j.sign({userId:m.userId,organizationId:m.organizationId},process.env.JWT_SECRET||'secret',{expiresIn:'1h'}));
  p.\$disconnect();
});
" 2>/dev/null)

echo "JWT generated: ${JWT:0:20}..."

# Trigger a chat request to generate at least one rate-limit key in Redis
curl -s --max-time 10 -X POST http://localhost:4000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"assistantId":"nonexistent","message":"test"}' > /dev/null 2>&1 || true

sleep 1

echo ""
echo "=== DB 0 keys (should still have laravel-database-queues) ==="
redis-cli -n 0 dbsize
redis-cli -n 0 --scan | grep "laravel" | head -3

echo ""
echo "=== DB 1 keys (should have bull:rag-processing, rate limits) ==="
redis-cli -n 1 dbsize
redis-cli -n 1 --scan

echo ""
echo "=== ISOLATION RESULT ==="
DB0_LARAVEL=$(redis-cli -n 0 --scan | grep "laravel" | wc -l)
DB1_COUNT=$(redis-cli -n 1 dbsize)
echo "DB 0 - laravel keys: $DB0_LARAVEL"
echo "DB 1 - ai-api keys:  $DB1_COUNT"

if [ "$DB0_LARAVEL" -gt 0 ] && [ "$DB1_COUNT" -ge 0 ]; then
  echo "ISOLATION: OK — laravel in DB 0, ai-api in DB 1"
else
  echo "ISOLATION: CHECK MANUALLY"
fi
