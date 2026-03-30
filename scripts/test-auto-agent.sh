#!/bin/bash
cd /var/www/site-al.ru/apps/api
JWT=$(timeout 12 node gen-jwt-test.js 2>/dev/null)
if [ -z "$JWT" ]; then
  echo "ERROR: could not generate JWT"
  exit 1
fi
echo "JWT: ${JWT:0:40}..."
echo ""
echo "=== POST /ai/auto-agent ==="
curl -s -m 90 -X POST http://127.0.0.1:4000/ai/auto-agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"description":"Я занимаюсь натяжными потолками, хочу получать заявки с сайта"}' \
  2>&1 | head -c 800
echo ""
echo "=== DONE ==="
