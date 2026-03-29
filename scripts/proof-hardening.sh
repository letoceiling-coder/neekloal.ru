#!/usr/bin/env bash
set -euo pipefail
API=http://127.0.0.1:4000

# ── Bootstrap: register + login + create assistant
TS=$(date +%s)
EMAIL="hardening-${TS}@test.local"
PASS="Test123!"

echo "=== REGISTER ==="
REG=$(curl -sf -X POST $API/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Hard Test\"}")
echo "$REG"

echo "=== LOGIN ==="
LOGIN=$(curl -sf -X POST $API/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
JWT=$(echo "$LOGIN" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "JWT obtained: ${JWT:0:32}..."

echo "=== CREATE ASSISTANT ==="
ASST=$(curl -sf -X POST $API/assistants \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"Hard Assistant","model":"gemma3:1b","systemPrompt":"You are a test assistant."}')
echo "$ASST"
ASST_ID=$(echo "$ASST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "assistantId=$ASST_ID"

echo ""
echo "=== STEP 1: CREATE API KEY (no allowedDomains) ==="
KEY_RESP=$(curl -sf -X POST $API/api-keys \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"name\":\"hardening-test\"}")
echo "$KEY_RESP"
SK=$(echo "$KEY_RESP" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)
echo "api-key=${SK:0:16}..."

echo ""
echo "=== STEP 2: RATE LIMIT TEST (send 65 req → expect 429) ==="
echo "Sending 65 rapid requests..."
COUNT_429=0
for i in $(seq 1 65); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $API/chat \
    -H "X-Api-Key: $SK" \
    -H "Content-Type: application/json" \
    -d "{\"assistantId\":\"$ASST_ID\",\"message\":\"ping\"}")
  if [ "$CODE" = "429" ]; then
    COUNT_429=$((COUNT_429+1))
  fi
done
echo "Got 429 responses: $COUNT_429 (expect >= 5)"

echo ""
echo "=== STEP 3: RATE LIMIT HEADERS ==="
curl -si -X POST $API/chat \
  -H "X-Api-Key: $SK" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"message\":\"ping\"}" \
  | grep -i "x-ratelimit\|retry-after" || true

echo ""
echo "=== STEP 4: COST CHECK - send 1 fresh request with new key ==="
KEY2_RESP=$(curl -sf -X POST $API/api-keys \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"name\":\"cost-test\"}")
SK2=$(echo "$KEY2_RESP" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)
echo "cost-test-key=${SK2:0:16}..."

curl -sf -X POST $API/chat \
  -H "X-Api-Key: $SK2" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"message\":\"Hello\"}" > /dev/null
echo "Chat request sent"

echo ""
echo "=== STEP 5: CHECK usage.cost in DB ==="
export PGURI="${DATABASE_URL%%\?*}"
psql "$PGURI" -tAc "
  SELECT u.id, u.model, u.tokens, u.cost, u.created_at
  FROM usages u
  JOIN api_keys k ON k.id = u.api_key_id
  WHERE k.name = 'cost-test'
  ORDER BY u.created_at DESC
  LIMIT 1;
"

echo ""
echo "=== STEP 6: SSE STREAM TEST - 5s then disconnect ==="
curl -sN --max-time 5 -X POST $API/chat/stream \
  -H "X-Api-Key: $SK2" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"message\":\"Tell me a long story about space\"}" \
  2>&1 | head -20 || true

echo ""
echo "=== STEP 7: PM2 LOGS (tail) ==="
pm2 logs ai-api --lines 10 --nostream 2>&1 | tail -20

echo ""
echo "=== PROOF COMPLETE ==="
