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

echo "===== Qdrant status ====="
curl -s http://188.124.55.89:6333/collections/knowledge_chunks \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print('status:', r['status'], '| points:', r['points_count'], '| vectors_dim:', r['config']['params']['vectors']['size'])"

echo ""
echo "===== Knowledge in DB ====="
psql "$PGURI" -c "SELECT type, status, LEFT(content,80) AS preview FROM knowledge WHERE assistant_id='$ASST_ID'::uuid ORDER BY created_at DESC LIMIT 5;"

echo ""
echo "===== Qdrant direct search ====="
python3 - <<'PYEOF'
import json, urllib.request

# Get embedding for query
req_data = json.dumps({"model": "nomic-embed-text", "prompt": "стоимость про тарифа"}).encode()
req = urllib.request.Request("http://188.124.55.89:11434/api/embeddings",
    data=req_data, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=10) as resp:
    emb_data = json.load(resp)
vec = emb_data["embedding"]
print(f"Query vector dim: {len(vec)}")

# Search Qdrant
search_payload = json.dumps({
    "vector": vec,
    "limit": 5,
    "with_payload": True
}).encode()
req2 = urllib.request.Request(
    "http://188.124.55.89:6333/collections/knowledge_chunks/points/search",
    data=search_payload, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req2, timeout=10) as resp:
    result = json.load(resp)

print(f"Found {len(result.get('result', []))} chunks:")
for r in result.get("result", []):
    content = r["payload"].get("content", "")[:100]
    score = r["score"]
    print(f"  score={score:.3f} | {content}")
PYEOF

echo ""
echo "===== CHAT STREAM — RAG retrieval ====="
echo "Question: Сколько стоит Про тариф?"
CHAT=$(curl -s -m 30 -X POST "$API/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"message\":\"Сколько стоит Про тариф NeekloAI?\"}" \
  --no-buffer 2>&1)
echo "$CHAT" | grep "^data:" | head -15
FULL_TEXT=$(echo "$CHAT" | grep "^data:" | python3 -c "
import sys, json
text = ''
for line in sys.stdin:
    try:
        d = json.loads(line[5:].strip())
        text += d.get('token', '')
    except: pass
print('FULL ANSWER:', text)
")
echo "$FULL_TEXT"

echo ""
echo "===== PM2 logs — RAG lines ====="
pm2 logs ai-api --nostream --lines 80 2>&1 \
  | grep -E "(rag|ragWorker|ingest|embedding|chunk|qdrant|retrieval|QDRANT)" \
  | tail -20

echo ""
echo "===== DONE ====="
