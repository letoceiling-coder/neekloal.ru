#!/usr/bin/env bash
set -euo pipefail
API="https://site-al.ru/api"
PGURI="postgresql://ai_user:e2be1c4776d8e8c00e03ae5214fccf9afc9cc549f2f272ffd192f24a5857c359@localhost:5432/neekloal_saas"
JWT_SECRET="8c204ce5ad218f00191160bda8fefe30ea2341f2ead3af5760a627d69ba35b71"
USER_ID="3e03db74-38cc-4e5f-b33b-61bfbf512cd2"
ORG_ID="41aed2ec-bcfc-484f-a5c8-b766dce9cf8a"
ASST_ID="dd820951-92dd-4009-9c6d-3cdbf858f2ab"

cd /var/www/site-al.ru/apps/api
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
process.stdout.write(jwt.sign(
  { userId: '$USER_ID', organizationId: '$ORG_ID', role: 'owner' },
  '$JWT_SECRET', { expiresIn: '2h' }
));
")

echo "===== STEP 1: Redis ping ====="
redis-cli ping
redis-cli info server | grep "redis_version"

echo ""
echo "===== STEP 2: BullMQ worker started? ====="
pm2 logs ai-api --nostream --lines 30 2>&1 | grep -iE "bullmq|ragWorker|BullMQ" | tail -5

echo ""
echo "===== STEP 3: POST /knowledge → job added to BullMQ ====="
NEW_K=$(curl -s -X POST "$API/knowledge" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"content\":\"BullMQ test: NeekloAI Pro тариф стоит 9990 рублей. Включает неограниченные запросы.\"}")
echo "POST /knowledge: $NEW_K"
K_ID=$(echo "$NEW_K" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

echo ""
echo "===== STEP 4: Check BullMQ queue job ====="
node -e "
const { getRagQueue } = require('./src/queue/ragQueue');
const q = getRagQueue();
if (!q) { console.log('Queue not available'); process.exit(0); }
Promise.all([
  q.getWaitingCount(),
  q.getActiveCount(),
  q.getCompletedCount(),
  q.getFailedCount()
]).then(([w, a, c, f]) => {
  console.log('Queue stats: waiting=' + w + ' active=' + a + ' completed=' + c + ' failed=' + f);
  process.exit(0);
}).catch(e => { console.log('Error:', e.message); process.exit(0); });
" 2>&1

echo ""
echo "===== STEP 5: Wait 10s for BullMQ worker to process ====="
sleep 10

echo ""
echo "===== STEP 6: Check per-assistant Qdrant collection ====="
COLL_NAME="asst_${ASST_ID//-/}"
echo "Expected collection: $COLL_NAME"
QDRANT_RESP=$(curl -s "http://188.124.55.89:6333/collections/$COLL_NAME")
echo "Qdrant collection: $QDRANT_RESP" | python3 -c "
import sys, json
data = sys.stdin.read()
try:
    d = json.loads(data.split('Qdrant collection: ', 1)[1])
    r = d.get('result', {})
    print(f'status={r.get(\"status\")} | points={r.get(\"points_count\")} | dim={r.get(\"config\",{}).get(\"params\",{}).get(\"vectors\",{}).get(\"size\")}')
except Exception as e:
    print('parse error:', e)
    print('raw:', data[:300])
" 2>/dev/null || echo "Raw: $QDRANT_RESP" | head -c 300

echo ""
echo "===== STEP 7: Check knowledge status in DB ====="
psql "$PGURI" -c "SELECT type, status, LEFT(content,60) AS preview FROM knowledge WHERE assistant_id='$ASST_ID'::uuid ORDER BY created_at DESC LIMIT 5;"

echo ""
echo "===== STEP 8: FIRST chat (no cache) ====="
T1=$(date +%s%3N)
CHAT1=$(curl -s -m 30 -X POST "$API/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"message\":\"Что включает Про тариф?\"}" \
  --no-buffer 2>&1)
T2=$(date +%s%3N)
FIRST_MS=$((T2 - T1))
FIRST_ANS=$(echo "$CHAT1" | grep "^data:" | python3 -c "
import sys, json; text=''
for line in sys.stdin:
    try: text += json.loads(line[5:].strip()).get('token', '')
    except: pass
print(text)
" 2>/dev/null)
echo "First call: ${FIRST_MS}ms"
echo "Answer: $FIRST_ANS"

echo ""
echo "===== STEP 9: Check Redis cache key ====="
redis-cli keys "rag:${ASST_ID}:*" | head -5

echo ""
echo "===== STEP 10: SECOND chat (should hit cache — faster) ====="
T3=$(date +%s%3N)
CHAT2=$(curl -s -m 30 -X POST "$API/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"message\":\"Что включает Про тариф?\"}" \
  --no-buffer 2>&1)
T4=$(date +%s%3N)
SECOND_MS=$((T4 - T3))
echo "Second call: ${SECOND_MS}ms"

echo ""
echo "===== STEP 11: PM2 logs — BullMQ + RAG lines ====="
pm2 logs ai-api --nostream --lines 60 2>&1 | grep -iE "(bullmq|ragWorker|rag ingest|rag retrieval|cache hit|per-assistant|asst_)" | tail -20

echo ""
echo "===== STEP 12: All Qdrant collections ====="
curl -s http://188.124.55.89:6333/collections | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d.get('result',{}).get('collections',[]):
    print(' -', c['name'])
"

echo ""
echo "===== ALL PROOFS DONE ====="
