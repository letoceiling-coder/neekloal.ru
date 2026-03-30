#!/usr/bin/env bash
set -euo pipefail
API="https://site-al.ru/api"
PGURI="postgresql://ai_user:e2be1c4776d8e8c00e03ae5214fccf9afc9cc549f2f272ffd192f24a5857c359@localhost:5432/neekloal_saas"
JWT_SECRET="8c204ce5ad218f00191160bda8fefe30ea2341f2ead3af5760a627d69ba35b71"
USER_ID="3e03db74-38cc-4e5f-b33b-61bfbf512cd2"
ORG_ID="41aed2ec-bcfc-484f-a5c8-b766dce9cf8a"
ASST_ID="dd820951-92dd-4009-9c6d-3cdbf858f2ab"

cd /var/www/site-al.ru/apps/api

echo "===== STEP 1: Qdrant health check ====="
curl -s http://188.124.55.89:6333/collections
echo ""

echo "===== STEP 2: Generate JWT ====="
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
process.stdout.write(jwt.sign(
  { userId: '$USER_ID', organizationId: '$ORG_ID', role: 'owner' },
  '$JWT_SECRET', { expiresIn: '2h' }
));
")
echo "TOKEN: ${TOKEN:0:40}..."

echo ""
echo "===== STEP 3: Test GPU embeddings ====="
EMBED=$(curl -s -m 10 -X POST http://188.124.55.89:11434/api/embeddings \
  -H "Content-Type: application/json" \
  --data-binary '{"model":"nomic-embed-text","prompt":"test embedding"}')
DIM=$(echo "$EMBED" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('embedding',[])))" 2>/dev/null)
echo "Embedding dim: $DIM"
if [ "$DIM" -gt 100 ]; then
  echo "✓ GPU embeddings OK (dim=$DIM)"
else
  echo "⚠ Embedding response: ${EMBED:0:200}"
fi

echo ""
echo "===== STEP 4: POST /knowledge (with reindex=true to trigger Qdrant) ====="
TXT=$(curl -s -X POST "$API/knowledge" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"content\":\"NeekloAI — AI платформа. Базовый тариф: 2990 руб/мес. Про тариф: 9990 руб/мес. CEO: Иван Петров. Телефон: +7-495-123-45-67.\"}")
echo "POST /knowledge: $TXT"
K_ID=$(echo "$TXT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

echo ""
echo "===== STEP 5: POST /knowledge/reindex (force Qdrant indexing) ====="
RIDX=$(curl -s -X POST "$API/knowledge/reindex" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\"}")
echo "REINDEX response: $RIDX"

echo ""
echo "===== STEP 6: Wait 15s for ingest + embeddings ====="
sleep 15

echo ""
echo "===== STEP 7: Check Qdrant collections ====="
curl -s http://188.124.55.89:6333/collections
echo ""

echo "===== STEP 8: Check Qdrant collection points ====="
COLL=$(curl -s http://188.124.55.89:6333/collections/knowledge_chunks 2>/dev/null)
echo "Collection: $COLL"
POINTS=$(echo "$COLL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('points_count',0))" 2>/dev/null)
echo "Total points in Qdrant: $POINTS"

echo ""
echo "===== STEP 9: Qdrant search (direct API) ====="
# Get a test embedding
QVEC=$(curl -s -m 10 -X POST http://188.124.55.89:11434/api/embeddings \
  -H "Content-Type: application/json" \
  --data-binary '{"model":"nomic-embed-text","prompt":"стоимость тарифа цена"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['embedding'][:5])" 2>/dev/null)
echo "Query vector (first 5 dims): $QVEC"

SEARCH=$(curl -s -X POST "http://188.124.55.89:6333/collections/knowledge_chunks/points/search" \
  -H "Content-Type: application/json" \
  --data-binary "{
    \"vector\": $(curl -s -m 10 -X POST http://188.124.55.89:11434/api/embeddings \
      -H 'Content-Type: application/json' \
      --data-binary '{\"model\":\"nomic-embed-text\",\"prompt\":\"стоимость тарифа\"}' \
      | python3 -c \"import sys,json; print(json.load(sys.stdin)['embedding'])\" 2>/dev/null),
    \"limit\": 3,
    \"with_payload\": true
  }" 2>/dev/null | head -c 500)
echo "Qdrant search result: $SEARCH"

echo ""
echo "===== STEP 10: DB — knowledge status ====="
psql "$PGURI" -c "SELECT type, source_name, status, LEFT(content,60) AS preview FROM knowledge WHERE assistant_id='$ASST_ID'::uuid ORDER BY created_at DESC LIMIT 5;"

echo ""
echo "===== STEP 11: GET /knowledge list (check chunkCount) ====="
curl -s "$API/knowledge?assistantId=$ASST_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; items=json.load(sys.stdin); [print(f'{i[\"type\"]:6} | {(i[\"sourceName\"] or \"(text)\"):30} | status={i[\"status\"]:12} | chunks={i[\"chunkCount\"]}') for i in items]" 2>/dev/null

echo ""
echo "===== STEP 12: CHAT with RAG — question about pricing ====="
echo "Sending: 'Сколько стоит про тариф NeekloAI?'"
curl -s -m 30 -X POST "$API/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"message\":\"Сколько стоит Про тариф NeekloAI?\"}" \
  --no-buffer 2>&1 | grep -E "^data:" | head -20

echo ""
echo "===== STEP 13: PM2 logs — RAG worker lines ====="
pm2 logs ai-api --nostream --lines 50 2>&1 | grep -iE "ragWorker|rag ingest|rag retrieval|embedding|chunk|QDRANT" | tail -20

echo ""
echo "===== ALL PROOFS DONE ====="
