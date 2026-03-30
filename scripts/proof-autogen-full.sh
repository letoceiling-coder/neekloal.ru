#!/bin/bash
cd /var/www/site-al.ru/apps/api
cp /tmp/proof-autogen.js .
JWT=$(node proof-autogen.js 2>/dev/null)
rm -f proof-autogen.js
echo "JWT: ${JWT:0:50}..."
curl -s -X POST http://localhost:4000/agents/auto-generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"input":"Bot dlya prodazh saytov v studii"}'
echo ""
echo "---DONE---"
