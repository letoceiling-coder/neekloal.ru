#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:4000}"
PASS="ProofKey2026"
EMAIL="keyproof-$(date +%s)@example.com"

echo "=== STEP 1: register + JWT ==="
REG=$(curl -sS -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "$REG" | node -e "
const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('email:', j.user&&j.user.email);
console.log('tokenLen:', (j.accessToken||'').length);
"
TOKEN=$(echo "$REG" | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(j.accessToken||'')")
[ -n "$TOKEN" ] || { echo "FAIL: no JWT"; exit 1; }

echo ""
echo "=== STEP 2: create assistant ==="
ASST=$(curl -sS -X POST "$BASE/assistants" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Widget Asst","model":"mistral","systemPrompt":"Ты виджет-ассистент. Отвечай коротко."}')
echo "$ASST"
AID=$(echo "$ASST" | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(j.id||'')")
[ -n "$AID" ] || { echo "FAIL: no assistantId"; exit 1; }
echo "  assistantId: $AID"

echo ""
echo "=== STEP 3: create api key with assistantId ==="
KEY_BODY=$(node -e "process.stdout.write(JSON.stringify({name:'Widget Key',assistantId:'$AID'}))")
KEY_RES=$(curl -sS -w "\nHTTP:%{http_code}" -X POST "$BASE/api-keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$KEY_BODY")
echo "$KEY_RES"
SK=$(echo "$KEY_RES" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const lines=d.split('\n');const j=JSON.parse(lines[0]);process.stdout.write(j.key||'');})")
[ -n "$SK" ] || { echo "FAIL: no sk-key"; exit 1; }
echo "  sk-key: $SK"

echo ""
echo "=== STEP 4: GET /api-keys — verify assistantId stored ==="
curl -sS "$BASE/api-keys" -H "Authorization: Bearer $TOKEN"
echo ""

echo ""
echo "=== STEP 5: chat via X-Api-Key (NO assistantId in body) ==="
printf '%s' '{"message":"Привет, как дела?"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK" \
  -H "X-Widget-Client: 1" \
  -d @-

echo ""
echo "=== STEP 6: chat via Authorization: Bearer sk-xxx (NO assistantId in body) ==="
printf '%s' '{"message":"Что умеешь?"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SK" \
  -d @-

echo ""
echo "=== STEP 7: chat with explicit assistantId still works ==="
MSG=$(node -e "process.stdout.write(JSON.stringify({assistantId:'$AID',message:'Тест прямой'}))")
printf '%s' "$MSG" | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK" \
  -d @-

echo ""
echo "=== STEP 8: wrong key → 401 ==="
printf '%s' '{"message":"test"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sk-0000000000000000000000000000000000000" \
  -d @-
