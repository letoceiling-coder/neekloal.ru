#!/usr/bin/env bash
set -euo pipefail
API=http://127.0.0.1:4000

# Load DATABASE_URL from api .env
set -o allexport
source /var/www/site-al.ru/apps/api/.env
set +o allexport
export PGURI="${DATABASE_URL%%\?*}"

# ── Bootstrap
TS=$(date +%s)
EMAIL="hardening2-${TS}@test.local"
PASS="Test123!"

echo "=== REGISTER ==="
REG=$(curl -sf -X POST $API/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Hard Test\"}")

echo "=== LOGIN ==="
LOGIN=$(curl -sf -X POST $API/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
JWT=$(echo "$LOGIN" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "JWT: ${JWT:0:32}..."

echo "=== CREATE ASSISTANT ==="
ASST=$(curl -sf -X POST $API/assistants \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"Cost Test Asst","model":"gemma3:1b","systemPrompt":"You are concise. Answer in 1 sentence."}')
ASST_ID=$(echo "$ASST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "assistantId=$ASST_ID"

echo ""
echo "=== CREATE API KEY FOR COST TEST ==="
KEY_RESP=$(curl -sf -X POST $API/api-keys \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"name\":\"cost-proof\"}")
echo "$KEY_RESP"
SK=$(echo "$KEY_RESP" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)
KEY_ID=$(echo "$KEY_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "api-key=${SK:0:20}..."
echo "key-id=$KEY_ID"

echo ""
echo "=== SEND CHAT REQUEST (to generate usage) ==="
CHAT=$(curl -sf -X POST $API/chat \
  -H "X-Api-Key: $SK" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"message\":\"Say hello\"}")
echo "$CHAT"

echo ""
echo "=== CHECK usage.cost IN DB ==="
psql "$PGURI" -tAc "
  SELECT u.id, u.model, u.tokens, u.cost::text, u.created_at
  FROM usages u
  WHERE u.api_key_id = '$KEY_ID'
  ORDER BY u.created_at DESC
  LIMIT 3;
"

echo ""
echo "=== PLAN costPer1kTokens COLUMN CHECK ==="
psql "$PGURI" -tAc "
  SELECT p.slug, p.name, p.cost_per_1k_tokens
  FROM plans p
  WHERE p.deleted_at IS NULL
  LIMIT 5;
"

echo ""
echo "=== SSE STREAM TEST (5s timeout then disconnect) ==="
echo "--- SSE events received:"
timeout 5 curl -sN -X POST $API/chat/stream \
  -H "X-Api-Key: $SK" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"message\":\"Tell me something interesting about the universe\"}" \
  2>&1 | head -30 || true

echo ""
echo "=== PM2 TAIL (abort/timeout log check) ==="
pm2 logs ai-api --lines 15 --nostream 2>&1 | grep -E "rateLimit|stream|abort|timeout|disconnect" | tail -10 || true

echo ""
echo "=== DONE ==="
