#!/usr/bin/env bash
set -euo pipefail
API=https://site-al.ru/api
source /var/www/site-al.ru/apps/api/.env

echo "===== STEP 0: GET JWT ====="
LOGIN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@neekloal.ru","password":"password123"}')
TOKEN=$(echo "$LOGIN" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then
  echo "ERROR: no token. Response: $LOGIN"
  exit 1
fi
echo "TOKEN OK: ${TOKEN:0:30}..."

echo ""
echo "===== STEP 1: GET ASSISTANT ID ====="
ASSISTANTS=$(curl -s "$API/assistants" -H "Authorization: Bearer $TOKEN")
ASST_ID=$(echo "$ASSISTANTS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$ASST_ID" ]; then
  echo "ERROR: no assistant. Creating one..."
  CREATED=$(curl -s -X POST "$API/assistants" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"RAG Test","model":"llama3.2:3b","systemPrompt":"You are a helpful assistant."}')
  ASST_ID=$(echo "$CREATED" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi
echo "ASSISTANT ID: $ASST_ID"

echo ""
echo "===== STEP 2: GET /knowledge (baseline) ====="
curl -s "$API/knowledge?assistantId=$ASST_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null || echo "(no items yet)"

echo ""
echo "===== STEP 3: POST /knowledge (TEXT) ====="
RESP=$(curl -s -X POST "$API/knowledge" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"content\":\"Компания NeekloAI основана в 2025 году в Москве. Мы предоставляем AI-решения для бизнеса. Наш главный продукт — интеллектуальный чат-ассистент. Стоимость базового тарифа — 2990 рублей в месяц.\"}")
echo "RESPONSE:"
echo "$RESP" | python3 -m json.tool
TXT_ID=$(echo "$RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "TEXT KNOWLEDGE ID: $TXT_ID"

echo ""
echo "===== STEP 4: POST /knowledge/url ====="
URL_RESP=$(curl -s -X POST "$API/knowledge/url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"url\":\"https://example.com\"}")
echo "RESPONSE:"
echo "$URL_RESP" | python3 -m json.tool
URL_ID=$(echo "$URL_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "URL KNOWLEDGE ID: $URL_ID"

echo ""
echo "===== STEP 5: POST /knowledge/upload (TXT file) ====="
echo "This is a test knowledge document for NeekloAI RAG system. The CEO is Ivan Petrov." > /tmp/test_knowledge.txt
UPLOAD_RESP=$(curl -s -X POST "$API/knowledge/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "assistantId=$ASST_ID" \
  -F "file=@/tmp/test_knowledge.txt;type=text/plain")
echo "RESPONSE:"
echo "$UPLOAD_RESP" | python3 -m json.tool
FILE_ID=$(echo "$UPLOAD_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "FILE KNOWLEDGE ID: $FILE_ID"

echo ""
echo "===== STEP 6: Wait 3s for background ingest, then GET /knowledge ====="
sleep 3
LIST=$(curl -s "$API/knowledge?assistantId=$ASST_ID" -H "Authorization: Bearer $TOKEN")
echo "LIST:"
echo "$LIST" | python3 -m json.tool

echo ""
echo "===== STEP 7: Check DB — status column ====="
export PGURI="${DATABASE_URL%%\?*}"
psql "$PGURI" -c "SELECT id, type, source_name, status, LEFT(content,60) AS preview FROM knowledge WHERE assistant_id='$ASST_ID'::uuid ORDER BY created_at DESC LIMIT 5;"

echo ""
echo "===== STEP 8: CHAT WITH RAG — question about NeekloAI ====="
curl -s -X POST "$API/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"message\":\"Сколько стоит базовый тариф NeekloAI?\"}" \
  --no-buffer 2>&1 | head -40

echo ""
echo "===== STEP 9: DELETE one knowledge item ====="
if [ -n "$TXT_ID" ]; then
  DEL_RESP=$(curl -s -X DELETE "$API/knowledge/$TXT_ID" -H "Authorization: Bearer $TOKEN")
  echo "DELETE response: $DEL_RESP"
else
  echo "SKIP: no text ID to delete"
fi

echo ""
echo "===== DONE ====="
