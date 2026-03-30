#!/bin/bash
echo "=== 1. OLLAMA PROCESS (GPU SERVER 188.124.55.89) ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@188.124.55.89 "ps aux | grep ollama | grep -v grep" 2>/dev/null || echo "SSH to GPU server not available (expected)"

echo ""
echo "=== 2. OLLAMA API TAGS ==="
curl -s --max-time 5 http://188.124.55.89:11434/api/tags | python3 -m json.tool 2>/dev/null || \
  curl -s --max-time 5 http://188.124.55.89:11434/api/tags

echo ""
echo "=== 3. OLLAMA RUNNING MODELS ==="
curl -s --max-time 5 http://188.124.55.89:11434/api/ps 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "(no /api/ps or error)"

echo ""
echo "=== 4. OLLAMA VERSION ==="
curl -s --max-time 5 http://188.124.55.89:11434/api/version 2>/dev/null || echo "(no version endpoint)"

echo ""
echo "=== 5. LATENCY TEST — 3 requests to /chat ==="
JWT=$(node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();
async function main() {
  const m = await prisma.membership.findFirst({ where: { role: 'OWNER' }, include: { user: true } });
  const a = await prisma.assistant.findFirst({});
  if (!m || !a) { process.exit(1); }
  console.log(jwt.sign({ userId: m.user.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) + '|' + a.id);
  await prisma.\$disconnect(); process.exit(0);
}
main().catch(() => process.exit(1));
" 2>/dev/null)
TOKEN=$(echo "$JWT" | cut -d'|' -f1)
ASST=$(echo "$JWT" | cut -d'|' -f2)

if [ -z "$TOKEN" ] || [ -z "$ASST" ]; then
  echo "Could not get JWT/ASST — skipping latency test"
else
  for i in 1 2 3; do
    START=$(date +%s%3N)
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST http://localhost:4000/chat \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"assistantId\":\"$ASST\",\"message\":\"Привет, как дела?\"}" \
      --max-time 60)
    END=$(date +%s%3N)
    ELAPSED=$((END - START))
    echo "Request $i → HTTP $STATUS  time: ${ELAPSED}ms"
  done
fi

echo ""
echo "=== 6. OLLAMA GENERATE LATENCY (direct) ==="
MODEL=$(curl -s --max-time 5 http://188.124.55.89:11434/api/tags | python3 -c "
import sys, json
data = json.load(sys.stdin)
models = data.get('models', [])
if models: print(models[0]['name'])
" 2>/dev/null || echo "mistral:latest")
echo "Using model: $MODEL"

START=$(date +%s%3N)
RESP=$(curl -s --max-time 60 -X POST http://188.124.55.89:11434/api/generate \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"prompt\":\"Say hello in one word.\",\"stream\":false}" 2>/dev/null)
END=$(date +%s%3N)
ELAPSED=$((END - START))
echo "Ollama direct generate: ${ELAPSED}ms"
echo "$RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('Response:', d.get('response','')[:80])
    evl = d.get('eval_count', 0)
    evd = d.get('eval_duration', 1)
    pt  = d.get('prompt_eval_count', 0)
    ptd = d.get('prompt_eval_duration', 1)
    print(f'Tokens generated: {evl}  ({round(evl/(evd/1e9),1)} tok/s)')
    print(f'Prompt eval: {pt} tokens  ({round(pt/(ptd/1e9),1)} tok/s)')
except: print('parse error')
" 2>/dev/null

echo ""
echo "=== 7. GPU INFO VIA OLLAMA API (if exposed) ==="
# Check if GPU info is visible through Ollama's ps endpoint
curl -s --max-time 5 http://188.124.55.89:11434/api/ps 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    models = d.get('models', [])
    for m in models:
        print('Running model:', m.get('name'))
        print('  size_vram:', m.get('size_vram', 'N/A'))
        print('  expires_at:', m.get('expires_at', 'N/A'))
except Exception as e:
    print('No running models or parse error:', e)
" 2>/dev/null

echo ""
echo "=== 8. EMBEDDING LATENCY ==="
START=$(date +%s%3N)
curl -s --max-time 10 -X POST http://188.124.55.89:11434/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"nomic-embed-text","prompt":"test embedding"}' \
  -o /dev/null -w "Embedding HTTP: %{http_code}" 2>/dev/null
END=$(date +%s%3N)
echo "  time: $((END - START))ms"
