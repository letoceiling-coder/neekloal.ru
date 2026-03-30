#!/bin/bash
set -e
cd /var/www/site-al.ru/apps/api

echo "=== 1. GENERATE JWT ==="
JWT=$(timeout 12 node gen-jwt-test.js 2>/dev/null)
if [ -z "$JWT" ]; then
  echo "ERROR: JWT empty"
  exit 1
fi
echo "JWT length: ${#JWT} chars"
echo "JWT prefix: ${JWT:0:30}..."

echo ""
echo "=== 2. POST /ai/auto-agent ==="
RESPONSE=$(curl -s -m 90 -X POST http://127.0.0.1:4000/ai/auto-agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"description":"Я продаю натяжные потолки, хочу получать заявки с сайта"}')

echo "RAW RESPONSE:"
echo "$RESPONSE"

echo ""
echo "=== 3. FIELD CHECK ==="
echo "$RESPONSE" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('systemPrompt:', repr(d.get('systemPrompt','MISSING')[:60]))
cfg = d.get('config', {})
print('config.intents keys:', list(cfg.get('intents',{}).keys()))
print('config.memory:', cfg.get('memory','MISSING'))
print('config.funnel:', cfg.get('funnel','MISSING'))
print('config.validation:', cfg.get('validation','MISSING'))
ok = bool(d.get('systemPrompt')) and bool(cfg.get('intents')) and bool(cfg.get('funnel'))
print('ALL FIELDS OK:', ok)
" 2>&1

echo ""
echo "=== 4. PM2 LOGS (last 20 lines) ==="
pm2 logs ai-api --lines 20 --nostream 2>&1 | tail -25

echo ""
echo "=== DONE ==="
