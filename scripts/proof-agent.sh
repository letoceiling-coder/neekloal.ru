#!/usr/bin/env bash
# Run on Linux server: bash proof-agent.sh
set -euo pipefail
BASE="${1:-http://127.0.0.1:4000}"
PASS="ProofAgent2026"

# ─── STEP 1: register fresh user ────────────────────────────────────────────
EMAIL="agent-proof-$(date +%s)@example.com"
echo "=== STEP 1: register / JWT ==="
REG=$(curl -sS -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "$REG" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
console.log('  email:', j.user&&j.user.email);
console.log('  orgId:', j.organizationId);
console.log('  tokenLen:', (j.accessToken||'').length);
"
TOKEN=$(echo "$REG" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');process.stdout.write(JSON.parse(d).accessToken||'')")
[ -n "$TOKEN" ] || { echo "FAIL: no token"; exit 1; }

# ─── STEP 2: assistant A — no agent ─────────────────────────────────────────
echo ""
echo "=== STEP 2: create assistant A (no agent) ==="
RES_A=$(curl -sS -X POST "$BASE/assistants" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"No-Agent Bot","model":"mistral","systemPrompt":"Ты обычный ассистент. Отвечай коротко."}')
echo "$RES_A"
AID_A=$(echo "$RES_A" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');process.stdout.write(JSON.parse(d).id||'')")
[ -n "$AID_A" ] || { echo "FAIL: no assistant A id"; exit 1; }
echo "  assistantId_A: $AID_A"

# ─── STEP 3+4: assistant B + agent with rules ────────────────────────────────
echo ""
echo "=== STEP 3: create assistant B (will have agent) ==="
RES_B=$(curl -sS -X POST "$BASE/assistants" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sales Agent Bot","model":"mistral","systemPrompt":"Ты ассистент продаж."}')
echo "$RES_B"
AID_B=$(echo "$RES_B" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');process.stdout.write(JSON.parse(d).id||'')")
[ -n "$AID_B" ] || { echo "FAIL: no assistant B id"; exit 1; }
echo "  assistantId_B: $AID_B"

echo ""
echo "=== STEP 4: create agent linked to assistant B ==="
RULES="Ты продающий менеджер. Всегда: задавай уточняющий вопрос, подводи к покупке, не давай короткие ответы."
AGENT_JSON=$(node -e "process.stdout.write(JSON.stringify({name:'Sales Agent',type:'chat',mode:'v1',assistantId:'$AID_B',rules:'$RULES'}))")
RES_AG=$(curl -sS -X POST "$BASE/agents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$AGENT_JSON")
echo "$RES_AG"
AGENT_ID=$(echo "$RES_AG" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');process.stdout.write(JSON.parse(d).id||'')")
[ -n "$AGENT_ID" ] || { echo "FAIL: no agent id"; exit 1; }
echo "  agentId: $AGENT_ID"

# ─── STEP 5: chat with assistant A ──────────────────────────────────────────
echo ""
echo "=== STEP 5: POST /chat — assistant A (NO agent) ==="
MSG_JSON=$(node -e "process.stdout.write(JSON.stringify({assistantId:'$AID_A',message:'Мне нужен потолок'}))")
RESPONSE_A=$(printf '%s' "$MSG_JSON" | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @-)
echo "RESPONSE_A:"
echo "$RESPONSE_A"

# ─── STEP 6: chat with assistant B ──────────────────────────────────────────
echo ""
echo "=== STEP 6: POST /chat — assistant B (WITH agent) ==="
MSG_JSON_B=$(node -e "process.stdout.write(JSON.stringify({assistantId:'$AID_B',message:'Мне нужен потолок'}))")
RESPONSE_B=$(printf '%s' "$MSG_JSON_B" | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @-)
echo "RESPONSE_B:"
echo "$RESPONSE_B"
