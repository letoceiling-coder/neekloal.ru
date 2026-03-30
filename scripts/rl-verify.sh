#!/bin/bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzZTAzZGI3NC0zOGNjLTRlNWYtYjMzYi02MWJmYmY1MTJjZDIiLCJpYXQiOjE3NzQ4ODY5NDIsImV4cCI6MTc3NDg5MDU0Mn0.k0lAj4hi0vyeR15J2xcnEVUSl8mGTPQrjFuGDBi0jcI"
ASST="eebd8b99-0b17-4773-99a0-d3b08a13557d"

echo "=== REDIS DB1 KEYS BEFORE ==="
redis-cli -n 1 keys "rl:*"

echo ""
echo "=== 5 RAPID REQUESTS ==="
for i in 1 2 3 4 5; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:4000/chat \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{\"assistantId\":\"$ASST\",\"message\":\"rl test $i\"}" \
    --max-time 30)
  echo "Request $i → HTTP $STATUS"
done

echo ""
echo "=== REDIS DB1 rl: KEYS AFTER ==="
redis-cli -n 1 keys "rl:*"

echo ""
echo "=== KEY VALUES ==="
for k in $(redis-cli -n 1 keys "rl:*"); do
  val=$(redis-cli -n 1 get "$k")
  ttl=$(redis-cli -n 1 ttl "$k")
  echo "  $k = count:$val  TTL:${ttl}s"
done

echo ""
echo "=== PM2 LOGS: rateLimit:redis entries ==="
pm2 logs ai-api --lines 80 --nostream 2>/dev/null | grep "\[rateLimit:redis\]" | head -20

echo ""
echo "=== CHECK: no Prisma RateLimitState in logs ==="
FOUND=$(pm2 logs ai-api --lines 80 --nostream 2>/dev/null | grep -c "RateLimitState" || true)
if [ "$FOUND" -gt "0" ]; then
  echo "WARNING: Prisma RateLimitState found $FOUND times"
else
  echo "OK — RateLimitState NOT in recent logs"
fi

echo ""
echo "=== CLEANUP ==="
rm -f /var/www/site-al.ru/apps/api/rl-test2.js
echo "done"
