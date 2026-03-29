#!/usr/bin/env bash
set -euo pipefail
API="https://site-al.ru/api"
PGURI="postgresql://ai_user:e2be1c4776d8e8c00e03ae5214fccf9afc9cc549f2f272ffd192f24a5857c359@localhost:5432/neekloal_saas"
JWT_SECRET="8c204ce5ad218f00191160bda8fefe30ea2341f2ead3af5760a627d69ba35b71"

echo "=== User + Org ==="
USER_ID=$(psql "$PGURI" -t -c "SELECT id FROM users ORDER BY created_at ASC LIMIT 1;" | tr -d ' \n')
ORG_ID=$(psql "$PGURI" -t -c "SELECT organization_id FROM memberships WHERE user_id='$USER_ID'::uuid LIMIT 1;" | tr -d ' \n')
echo "User=$USER_ID Org=$ORG_ID"

echo "=== Generate JWT ==="
cd /var/www/site-al.ru/apps/api
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
echo "$ASST_RESP" | python3 -c "import sys,json; a=json.load(sys.stdin); [print(x['id'], x['name']) for x in a[:3]]" 2>/dev/null || echo "$ASST_RESP" | head -c 200
ASST_ID=$(echo "$ASST_RESP" | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0]['id'])" 2>/dev/null)
echo "ASST_ID=$ASST_ID"

echo ""
echo "=== DB: knowledge columns ==="
psql "$PGURI" -c "\d knowledge" | grep -E "source_name|status|type|content"

echo ""
echo "=== POST /knowledge TEXT ==="
TXT=$(curl -s -X POST "$API/knowledge" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"content\":\"NeekloAI основана в 2025 году. Базовый тариф: 2990 рублей в месяц. CEO: Иван Петров.\"}")
echo "$TXT" | python3 -m json.tool 2>/dev/null || echo "$TXT"
TXT_ID=$(echo "$TXT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)

echo ""
echo "=== POST /knowledge/url ==="
URL_R=$(curl -s -X POST "$API/knowledge/url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"url\":\"https://example.com\"}")
echo "$URL_R" | python3 -m json.tool 2>/dev/null || echo "$URL_R"

echo ""
echo "=== POST /knowledge/upload (TXT) ==="
echo "NeekloAI support email: help@neekloai.ru. Office: Moscow Arbat 10." > /tmp/ktest.txt
FILE_R=$(curl -s -X POST "$API/knowledge/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "assistantId=$ASST_ID" \
  -F "file=@/tmp/ktest.txt;type=text/plain")
echo "$FILE_R" | python3 -m json.tool 2>/dev/null || echo "$FILE_R"

echo ""
echo "=== Wait 5s for background ingest ==="
sleep 5

echo ""
echo "=== GET /knowledge list ==="
curl -s "$API/knowledge?assistantId=$ASST_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null | head -60

echo ""
echo "=== DB: knowledge rows ==="
psql "$PGURI" -c "SELECT type, source_name, status, LEFT(content,70) AS preview FROM knowledge WHERE assistant_id='$ASST_ID'::uuid ORDER BY created_at DESC LIMIT 5;"

echo ""
echo "=== CHAT STREAM with RAG ==="
curl -s -m 25 -X POST "$API/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "{\"assistantId\":\"$ASST_ID\",\"message\":\"Сколько стоит базовый тариф?\"}" \
  --no-buffer | head -25

echo ""
echo "=== DELETE knowledge ==="
if [ -n "$TXT_ID" ]; then
  curl -s -X DELETE "$API/knowledge/$TXT_ID" -H "Authorization: Bearer $TOKEN"
fi

echo ""
echo "=== PM2 logs last 20 ==="
pm2 logs ai-api --nostream --lines 20 2>&1 | grep -E "rag|knowledge|ingest|chunk|upload|url" | tail -15 || true

echo ""
echo "===== ALL PROOFS DONE ====="
