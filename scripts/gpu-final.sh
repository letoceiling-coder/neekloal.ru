#!/bin/bash
cd /var/www/site-al.ru/apps/api

echo "=== AVAILABLE MODELS ON OLLAMA ==="
curl -s http://188.124.55.89:11434/api/tags | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    print(f\"  {m['name']}  ({m['details']['parameter_size']}, {m['details']['quantization_level']})\")
"

echo ""
echo "=== CURRENTLY LOADED IN VRAM ==="
curl -s http://188.124.55.89:11434/api/ps | python3 -c "
import sys, json
data = json.load(sys.stdin)
models = data.get('models', [])
if not models:
    print('  (none — cold)')
else:
    for m in models:
        gb = m.get('size_vram', 0) / 1024**3
        print(f\"  {m['name']}  VRAM: {gb:.2f} GB  expires: {m['expires_at']}\")
"

echo ""
echo "=== ASSISTANT MODEL IN DB ==="
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.assistant.findMany({ select: { id: true, name: true, model: true } }).then(list => {
  list.forEach(a => console.log('  ' + a.model + ' | ' + a.name + ' | ' + a.id));
  p.\$disconnect(); process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null

echo ""
echo "=== TEST GENERATE: mistral:latest ==="
START=$(date +%s%3N)
RESULT=$(curl -s --max-time 120 -X POST http://188.124.55.89:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"mistral:latest","prompt":"Скажи привет одним словом.","stream":false}')
END=$(date +%s%3N)
ELAPSED=$((END - START))
echo "Time: ${ELAPSED}ms"
echo "$RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
resp = d.get('response', '').strip()
evl  = d.get('eval_count', 0)
evd  = d.get('eval_duration', 1)
ld   = d.get('load_duration', 0)
td   = d.get('total_duration', 0)
print(f'Response: {repr(resp)}')
if evl: print(f'Speed: {evl/(evd/1e9):.1f} tok/s  ({evl} tokens)')
if ld:  print(f'Load time: {ld/1e9:.2f}s')
if td:  print(f'Total: {td/1e9:.2f}s')
" 2>/dev/null || echo "parse error: $RESULT"

echo ""
echo "=== TEST GENERATE: llama3:8b ==="
START=$(date +%s%3N)
RESULT=$(curl -s --max-time 120 -X POST http://188.124.55.89:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3:8b","prompt":"Скажи привет одним словом.","stream":false}')
END=$(date +%s%3N)
ELAPSED=$((END - START))
echo "Time: ${ELAPSED}ms"
echo "$RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
resp = d.get('response', '').strip()
evl  = d.get('eval_count', 0)
evd  = d.get('eval_duration', 1)
ld   = d.get('load_duration', 0)
td   = d.get('total_duration', 0)
print(f'Response: {repr(resp)}')
if evl: print(f'Speed: {evl/(evd/1e9):.1f} tok/s  ({evl} tokens)')
if ld:  print(f'Load time: {ld/1e9:.2f}s')
if td:  print(f'Total: {td/1e9:.2f}s')
" 2>/dev/null || echo "parse error: $RESULT"

echo ""
echo "=== LOADED AFTER TEST ==="
curl -s http://188.124.55.89:11434/api/ps | python3 -c "
import sys, json
data = json.load(sys.stdin)
models = data.get('models', [])
if not models:
    print('  (none)')
else:
    for m in models:
        gb = m.get('size_vram', 0) / 1024**3
        print(f\"  {m['name']}  VRAM: {gb:.2f} GB\")
"

echo ""
echo "=== EMBEDDING WARMUP ==="
for i in 1 2 3; do
  START=$(date +%s%3N)
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    -X POST http://188.124.55.89:11434/api/embeddings \
    -H "Content-Type: application/json" \
    -d '{"model":"nomic-embed-text","prompt":"тест производительности"}')
  END=$(date +%s%3N)
  echo "  Embed $i → HTTP $STATUS  $((END-START))ms"
done
