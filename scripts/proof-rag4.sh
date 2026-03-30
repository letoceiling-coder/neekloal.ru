#!/usr/bin/env bash
set -euo pipefail
API="https://site-al.ru/api"
PGURI="postgresql://ai_user:e2be1c4776d8e8c00e03ae5214fccf9afc9cc549f2f272ffd192f24a5857c359@localhost:5432/neekloal_saas"
JWT_SECRET="8c204ce5ad218f00191160bda8fefe30ea2341f2ead3af5760a627d69ba35b71"

USER_ID="3e03db74-38cc-4e5f-b33b-61bfbf512cd2"
ORG_ID="41aed2ec-bcfc-484f-a5c8-b766dce9cf8a"

cd /var/www/site-al.ru/apps/api

echo "=== Generate JWT ==="
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const t = jwt.sign(
  { userId: '$USER_ID', organizationId: '$ORG_ID', role: 'owner' },
  '$JWT_SECRET',
  { expiresIn: '2h' }
);
process.stdout.write(t);
")
echo "TOKEN: ${TOKEN:0:40}..."

echo ""
echo "=== GET /assistants ==="
ASST_RESP=$(curl -s "$API/assistants" -H "Authorization: Bearer $TOKEN")
echo "RAW: ${ASST_RESP:0:300}"
ASST_ID=$(echo "$ASST_RESP" | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0]['id'] if isinstance(a,list) and a else '')" 2>/dev/null)
echo "ASST_ID=$ASST_ID"

if [ -z "$ASST_ID" ]; then
  echo "Creating assistant..."
  CR=$(curl -s -X POST "$API/assistants" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary '{"name":"RAG Test","model":"llama3.2:3b","systemPrompt":"You are helpful."}')
  echo "Created: $CR"
  ASST_ID=$(echo "$CR" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
fi

echo "Using ASST_ID=$ASST_ID"

echo ""
echo "=== DB: knowledge columns ==="
psql "$PGURI" -c "\d knowledge" | grep -E "source_name|status|type|content"

echo ""
echo "=== POST /knowledge TEXT ==="
TXT=$(curl -s -X POST "$API/knowledge" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"content\":\"NeekloAI основана в 2025 году. Базовый тариф: 2990 рублей в месяц. CEO: Иван Петров.\"}")
echo "RESPONSE: $TXT"
TXT_ID=$(echo "$TXT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

echo ""
echo "=== POST /knowledge/url ==="
URL_R=$(curl -s -X POST "$API/knowledge/url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"url\":\"https://example.com\"}")
echo "URL RESPONSE: ${URL_R:0:300}"

echo ""
echo "=== POST /knowledge/upload (TXT) ==="
echo "NeekloAI support: help@neekloai.ru. Office: Moscow Arbat 10." > /tmp/ktest.txt
FILE_R=$(curl -s -X POST "$API/knowledge/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "assistantId=$ASST_ID" \
  -F "file=@/tmp/ktest.txt;type=text/plain")
echo "UPLOAD RESPONSE: ${FILE_R:0:300}"

echo ""
echo "=== Wait 5s for background ingest ==="
sleep 5

echo ""
echo "=== GET /knowledge list ==="
LIST=$(curl -s "$API/knowledge?assistantId=$ASST_ID" -H "Authorization: Bearer $TOKEN")
echo "LIST: $LIST"

echo ""
echo "=== DB: knowledge rows ==="
psql "$PGURI" -c "SELECT type, source_name, status, LEFT(content,70) AS preview FROM knowledge ORDER BY created_at DESC LIMIT 8;"

echo ""
echo "=== CHAT STREAM test ==="
curl -s -m 20 -X POST "$API/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"message\":\"Сколько стоит базовый тариф?\"}" \
  --no-buffer 2>&1 | head -30

echo ""
echo "=== PM2 logs (rag lines) ==="
pm2 logs ai-api --nostream --lines 30 2>&1 | grep -iE "rag|ingest|chunk|upload|knowledge" | tail -15 || true

echo ""
echo "===== ALL PROOFS DONE ====="
