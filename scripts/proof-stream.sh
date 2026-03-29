#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:4000}"
PASS="StreamProof2026"
EMAIL="stream-$(date +%s)@example.com"

echo "=== register + JWT ==="
REG=$(curl -sS -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN=$(echo "$REG" | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(j.accessToken||'')")
echo "token len: ${#TOKEN}"
[ -n "$TOKEN" ] || { echo "FAIL: no JWT"; exit 1; }

echo ""
echo "=== create assistant ==="
ASST=$(curl -sS -X POST "$BASE/assistants" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Stream Bot","model":"mistral","systemPrompt":"Ты помощник. Отвечай коротко."}')
AID=$(echo "$ASST" | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(j.id||'')")
echo "assistantId: $AID"

echo ""
echo "=== create api-key WITH allowedDomains ==="
KRES=$(curl -sS -X POST "$BASE/api-keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Stream Key\",\"assistantId\":\"$AID\",\"allowedDomains\":[\"allowed.example.com\"]}")
echo "$KRES"
SK=$(echo "$KRES" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.parse(d).key||'')})")
echo "sk-key: $SK"

echo ""
echo "=== STEP: /chat/stream SSE proof (X-Api-Key, no body.assistantId) ==="
echo "--- raw SSE events: ---"
printf '%s' '{"message":"Расскажи о себе кратко"}' | \
  curl -sS -N --no-buffer \
  -X POST "$BASE/chat/stream" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK" \
  -H "X-Widget-Client: 1" \
  -d @-
echo ""
echo "--- end SSE ---"

echo ""
echo "=== STEP: /chat (non-stream) still works ==="
printf '%s' '{"message":"Тест"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK" \
  -H "X-Widget-Client: 1" \
  -d @-

echo ""
echo "=== STEP: domain block — correct domain ==="
printf '%s' '{"message":"test"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK" \
  -H "Origin: https://allowed.example.com" \
  -d @-

echo ""
echo "=== STEP: domain block — wrong domain → 403 ==="
printf '%s' '{"message":"test"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK" \
  -H "Origin: https://evil.hacker.com" \
  -d @-

echo ""
echo "=== STEP: PATCH api-key — update allowedDomains ==="
KID=$(echo "$KRES" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.parse(d).id||'')})")
curl -sS -X PATCH "$BASE/api-keys/$KID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"allowedDomains":["allowed.example.com","*.mysite.ru"]}'
echo ""
