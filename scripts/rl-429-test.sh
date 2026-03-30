#!/bin/bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzZTAzZGI3NC0zOGNjLTRlNWYtYjMzYi02MWJmYmY1MTJjZDIiLCJpYXQiOjE3NzQ4ODcwNjQsImV4cCI6MTc3NDg5MDY2NH0.PJ_toAH9JeuSxG1C1Bb2IBC8jMqK39FXzDTJsH3QP9U"
ASST="eebd8b99-0b17-4773-99a0-d3b08a13557d"

echo "=== CLEAR OLD rl: KEYS ==="
redis-cli -n 1 keys "rl:*" | xargs -r redis-cli -n 1 del
echo "cleared"

echo ""
echo "=== SEND 5 REQUESTS ==="
for i in 1 2 3 4 5; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:4000/chat \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{\"assistantId\":\"$ASST\",\"message\":\"ping $i\"}" \
    --max-time 5)
  echo "Request $i → HTTP $STATUS"
done

echo ""
echo "=== REDIS KEY AFTER 5 ==="
for k in $(redis-cli -n 1 keys "rl:*"); do
  val=$(redis-cli -n 1 get "$k")
  ttl=$(redis-cli -n 1 ttl "$k")
  echo "  $k = count:$val  TTL:${ttl}s"
done

echo ""
echo "=== PM2 LOGS: rateLimit ==="
pm2 logs ai-api --lines 30 --nostream 2>/dev/null | grep "\[rateLimit" | tail -10

echo ""
echo "=== POSTGRES: no RateLimitState ==="
FOUND=$(pm2 logs ai-api --lines 50 --nostream 2>/dev/null | grep -c "RateLimitState" || true)
echo "RateLimitState hits in logs: $FOUND (should be 0)"

echo ""
rm -f /var/www/site-al.ru/apps/api/rl-gen-jwt.js
echo "cleanup done"
