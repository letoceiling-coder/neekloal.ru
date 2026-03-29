#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:4000}"
EMAIL="proof-$(date +%s)@example.com"
PASS="TestPass99"

echo "=== STEP 1 register + JWT ==="
REG=$(curl -sS -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "$REG"
TOKEN=$(echo "$REG" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.accessToken||'');})")

if [ -z "$TOKEN" ]; then
  echo "Register failed, try login"
  LOGIN=$(curl -sS -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
  echo "$LOGIN"
  TOKEN=$(echo "$LOGIN" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.accessToken||'');})")
fi

echo ""
echo "=== STEP 2a create assistant ==="
CRE=$(curl -sS -X POST "$BASE/assistants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Proof Bot","model":"mistral","systemPrompt":"You are a helpful assistant."}')
echo "$CRE"
AID=$(echo "$CRE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.id||'');}catch(e){}})")

if [ -z "$AID" ]; then
  echo "=== STEP 2b list assistants ==="
  ASST=$(curl -sS "$BASE/assistants" -H "Authorization: Bearer $TOKEN")
  echo "$ASST"
  AID=$(echo "$ASST" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const a=Array.isArray(j)?j:j.assistants||j.data||[];process.stdout.write((a[0]&&a[0].id)||'');}catch(e){}})")
fi

echo ""
echo "=== STEP 3 chat (assistantId=$AID) ==="
printf '%s' "{\"assistantId\":\"$AID\",\"message\":\"Привет\"}" | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @-
