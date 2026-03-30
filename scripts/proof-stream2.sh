#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:4000}"
PASS="StreamProof2026"
EMAIL="stream2-$(date +%s)@example.com"

echo "=== register + JWT ==="
REG=$(curl -sS -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN=$(echo "$REG" | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(j.accessToken||'')")
[ -n "$TOKEN" ] || { echo "FAIL: no JWT"; exit 1; }
echo "JWT OK"

echo ""
echo "=== create assistant ==="
ASST=$(curl -sS -X POST "$BASE/assistants" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Stream Bot","model":"mistral","systemPrompt":"Ты помощник. Отвечай коротко."}')
AID=$(echo "$ASST" | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(j.id||'')")
echo "assistantId: $AID"

echo ""
echo "=== create api-key WITHOUT domain restriction ==="
KRES=$(curl -sS -X POST "$BASE/api-keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Open Key\",\"assistantId\":\"$AID\"}")
echo "$KRES"
SK=$(echo "$KRES" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.parse(d).key||'')})")
echo "sk-key: $SK"

echo ""
echo "=== STEP STREAM: raw SSE events from /chat/stream ==="
printf '%s' '{"message":"Привет! Расскажи кратко что умеешь"}' | \
  curl -sS -N --no-buffer \
  -X POST "$BASE/chat/stream" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK" \
  -d @-
echo ""
echo "=== end SSE ==="

echo ""
echo "=== DOMAIN SECURITY: create key with allowedDomains ==="
K2=$(curl -sS -X POST "$BASE/api-keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Domain Key\",\"assistantId\":\"$AID\",\"allowedDomains\":[\"allowed.example.com\",\"*.mysite.ru\"]}")
SK2=$(echo "$K2" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.parse(d).key||'')})")
echo "domain key: $SK2"

echo ""
echo "--- correct domain → 200 ---"
printf '%s' '{"message":"test"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK2" \
  -H "Origin: https://allowed.example.com" \
  -d @-

echo ""
echo "--- subdomain *.mysite.ru → 200 ---"
printf '%s' '{"message":"test"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK2" \
  -H "Origin: https://shop.mysite.ru" \
  -d @-

echo ""
echo "--- evil domain → 403 ---"
printf '%s' '{"message":"test"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK2" \
  -H "Origin: https://evil.com" \
  -d @-

echo ""
echo "--- no origin header → 403 ---"
printf '%s' '{"message":"test"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK2" \
  -d @-
