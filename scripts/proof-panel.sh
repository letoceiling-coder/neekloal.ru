#!/usr/bin/env bash
set -euo pipefail
API=http://127.0.0.1:4000

TS=$(date +%s)
EMAIL="panel-${TS}@test.local"
PASS="Test123!"

echo "=== LOGIN ==="
REG=$(curl -sf -X POST $API/auth/register -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Panel Test\"}")
JWT=$(echo "$REG" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "JWT: ${JWT:0:32}..."

echo ""
echo "=== CREATE ASSISTANT ==="
ASST=$(curl -sf -X POST $API/assistants -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"Panel Asst","model":"gemma3:1b","systemPrompt":"You are a concise assistant."}')
echo "$ASST"
ASST_ID=$(echo "$ASST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "assistantId=$ASST_ID"

echo ""
echo "=== PATCH ASSISTANT ==="
PATCH=$(curl -sf -X PATCH $API/assistants/$ASST_ID -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"Panel Asst (edited)","systemPrompt":"You are a very concise assistant. One sentence."}')
echo "$PATCH" | grep -o '"name":"[^"]*"'

echo ""
echo "=== CREATE AGENT ==="
AGENT=$(curl -sf -X POST $API/agents -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Panel Agent\",\"type\":\"planner\",\"mode\":\"v1\",\"assistantId\":\"$ASST_ID\",\"rules\":\"Always answer in 1 sentence.\"}")
echo "$AGENT"
AGENT_ID=$(echo "$AGENT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "agentId=$AGENT_ID"

echo ""
echo "=== PATCH AGENT ==="
AGENT_PATCH=$(curl -sf -X PATCH $API/agents/$AGENT_ID -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"rules":"Always answer in English. Be concise. No more than 2 sentences."}')
echo "$AGENT_PATCH" | grep -o '"rules":"[^"]*"'

echo ""
echo "=== POST KNOWLEDGE ==="
KNOW=$(curl -sf -X POST $API/knowledge -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"content\":\"Our company was founded in 2020 and serves 1000 customers.\"}")
echo "$KNOW"

echo ""
echo "=== LIVE CHAT STREAM TEST ==="
curl -sN --max-time 8 -X POST $API/chat/stream \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$ASST_ID\",\"message\":\"Hello\"}" \
  2>&1 | head -15 || true

echo ""
echo "=== VERIFY ROUTES /assistants/:id exists in frontend build ==="
ls /var/www/site-al.ru/apps/web/dist/assets/index-*.js | head -1 | xargs grep -c "assistantId\|AssistantDetail" || true

echo ""
echo "=== DONE ==="
