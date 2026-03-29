#!/usr/bin/env bash
set -euo pipefail
source /var/www/site-al.ru/apps/api/.env

EMAIL="dsc-23@yandex.ru"
PASSWORD="password123"

API="https://site-al.ru/api"

echo ""
echo "===== JWT ====="
LOGIN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  --data-binary "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "LOGIN: $LOGIN" | head -c 200
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('accessToken',''))" 2>/dev/null)
echo ""
echo "TOKEN: ${TOKEN:0:30}..."

if [ -z "$TOKEN" ]; then
  echo "FAIL: no token"
  exit 1
fi

echo ""
echo "===== GET ASSISTANT ====="
ASSISTANTS=$(curl -s "$API/assistants" -H "Authorization: Bearer $TOKEN")
ASST_ID=$(echo "$ASSISTANTS" | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0]['id'] if a else '')" 2>/dev/null)
echo "ASSISTANT ID: $ASST_ID"

if [ -z "$ASST_ID" ]; then
  echo "Creating assistant..."
  CR=$(curl -s -X POST "$API/assistants" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary '{"name":"RAG Test","model":"llama3.2:3b","systemPrompt":"You are helpful."}')
  ASST_ID=$(echo "$CR" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
  echo "CREATED: $ASST_ID"
fi

echo ""
echo "===== DB: Check knowledge columns ====="
psql "$PGURI" -c "\d knowledge" 2>/dev/null | grep -E "source_name|status|type"

echo ""
echo "===== POST /knowledge (TEXT) ====="
CONTENT="Компания NeekloAI основана в 2025 году в Москве. Предоставляем AI-решения для бизнеса. Базовый тариф — 2990 рублей в месяц."
TXT_RESP=$(curl -s -X POST "$API/knowledge" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"content\":\"$CONTENT\"}")
echo "$TXT_RESP" | python3 -m json.tool 2>/dev/null || echo "$TXT_RESP"
TXT_ID=$(echo "$TXT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)

echo ""
echo "===== POST /knowledge/url ====="
URL_RESP=$(curl -s -X POST "$API/knowledge/url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"url\":\"https://example.com\"}")
echo "$URL_RESP" | python3 -m json.tool 2>/dev/null || echo "$URL_RESP"
URL_ID=$(echo "$URL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)

echo ""
echo "===== POST /knowledge/upload (TXT file) ====="
echo "NeekloAI CEO is Ivan Petrov. Support email: support@neekloai.ru. Office: Moscow, Arbat 1." > /tmp/tkn.txt
FILE_RESP=$(curl -s -X POST "$API/knowledge/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "assistantId=$ASST_ID" \
  -F "file=@/tmp/tkn.txt;type=text/plain")
echo "$FILE_RESP" | python3 -m json.tool 2>/dev/null || echo "$FILE_RESP"
FILE_ID=$(echo "$FILE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)

echo ""
echo "===== Wait 5s for ingest ====="
sleep 5

echo ""
echo "===== GET /knowledge list ====="
LIST=$(curl -s "$API/knowledge?assistantId=$ASST_ID" -H "Authorization: Bearer $TOKEN")
echo "$LIST" | python3 -m json.tool 2>/dev/null | head -80

echo ""
echo "===== DB: knowledge rows ====="
psql "$PGURI" -c "SELECT type, source_name, status, LEFT(content,60) AS preview FROM knowledge WHERE assistant_id='$ASST_ID'::uuid ORDER BY created_at DESC LIMIT 5;" 2>/dev/null

echo ""
echo "===== CHAT with RAG — stream 30s ====="
curl -s -m 30 -X POST "$API/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"message\":\"Сколько стоит базовый тариф?\"}" \
  --no-buffer 2>&1 | head -30

echo ""
echo "===== DELETE knowledge item ====="
if [ -n "$TXT_ID" ]; then
  DEL=$(curl -s -X DELETE "$API/knowledge/$TXT_ID" -H "Authorization: Bearer $TOKEN")
  echo "DELETE: $DEL"
fi

echo ""
echo "===== PM2 tail (last 20 lines) ====="
pm2 logs ai-api --nostream --lines 20 2>&1 | tail -25

echo ""
echo "===== ALL PROOFS DONE ====="
