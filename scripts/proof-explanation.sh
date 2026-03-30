#!/bin/bash
set -e
cd /var/www/site-al.ru/apps/api

echo "=== 1. GENERATE JWT ==="
JWT=$(timeout 12 node gen-jwt-test.js 2>/dev/null)
[ -z "$JWT" ] && echo "ERROR: JWT empty" && exit 1
echo "JWT: ${JWT:0:30}..."

echo ""
echo "=== 2. POST /ai/auto-agent (with explanation) ==="
RESP=$(curl -s -m 60 -X POST http://127.0.0.1:4000/ai/auto-agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"description":"Я продаю натяжные потолки, хочу получать заявки с сайта"}')

echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('systemPrompt:', d.get('systemPrompt','MISSING')[:60])
ex = d.get('explanation', {})
print('explanation.summary:', ex.get('summary','MISSING')[:80])
fd = ex.get('funnelDescription', [])
print('funnelDescription:', len(fd), 'stages:', [s['label'] for s in fd])
iid = ex.get('intentsDescription', [])
print('intentsDescription:', len(iid), 'intents:', [i['label'] for i in iid])
md = ex.get('memoryDescription', [])
print('memoryDescription:', len(md), 'fields:', [m['label'] for m in md])
dlg = ex.get('exampleDialog', [])
print('exampleDialog:', len(dlg), 'messages')
meta = ex.get('meta', {})
print('meta:', meta)
all_ok = bool(d.get('systemPrompt')) and len(fd) > 0 and len(iid) > 0 and len(dlg) > 0
print('')
print('ALL FIELDS OK:', all_ok)
"

echo ""
echo "=== 3. POST /ai/auto-agent/refine ==="
RESP2=$(curl -s -m 60 -X POST http://127.0.0.1:4000/ai/auto-agent/refine \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{\"systemPrompt\":\"Привет! Я помогу выбрать потолок.\",\"config\":{\"intents\":{\"pricing\":[\"цена\"]},\"memory\":[\"budget\"],\"funnel\":[\"greeting\",\"offer\",\"close\"],\"validation\":{\"maxSentences\":3,\"questions\":1}},\"instruction\":\"сделай более настойчиво\"}")

echo "$RESP2" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = bool(d.get('systemPrompt')) and bool(d.get('config')) and bool(d.get('explanation'))
print('refine systemPrompt:', d.get('systemPrompt','MISSING')[:60])
print('refine explanation.summary:', d.get('explanation',{}).get('summary','MISSING')[:60])
print('REFINE OK:', ok)
"

echo ""
echo "=== DONE ==="
