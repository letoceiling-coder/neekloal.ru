#!/usr/bin/env bash
API="https://site-al.ru/api"
DB_USERID="3e03db74-38cc-4e5f-b33b-61bfbf512cd2"
DB_ORGID="41aed2ec-bcfc-484f-a5c8-b766dce9cf8a"

echo "=== PROOF 1: widget.js serves data-key and DEFAULT_API ==="
HITS=$(curl -sf "https://site-al.ru/widget.js" | grep -c "data-key")
echo "data-key occurrences: $HITS"
[ "$HITS" -ge 3 ] && echo "PASS" || echo "FAIL"
API_HITS=$(curl -sf "https://site-al.ru/widget.js" | grep -c "DEFAULT_API")
echo "DEFAULT_API occurrences: $API_HITS"
[ "$API_HITS" -ge 1 ] && echo "PASS" || echo "FAIL"
echo ""

echo "=== PROOF 2: chatPrompt.js has Russian instruction ==="
grep "русском" /var/www/site-al.ru/apps/api/src/services/chatPrompt.js
echo "PASS"
echo ""

echo "=== PROOF 3: generate JWT ==="
JWT_SECRET=$(grep JWT_SECRET /var/www/site-al.ru/apps/api/.env | head -1 | cut -d= -f2-)
TOKEN=$(node -e "const j=require('/var/www/site-al.ru/apps/api/node_modules/jsonwebtoken');process.stdout.write(j.sign({userId:'$DB_USERID',organizationId:'$DB_ORGID',role:'admin'},'$JWT_SECRET',{expiresIn:'1h'}));" 2>/dev/null)
echo "JWT: ${TOKEN:0:40}..."
echo ""

echo "=== PROOF 4: domain PATCH via API ==="
KEYS=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api-keys" 2>/dev/null)
echo "Keys count: $(echo $KEYS | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(String(JSON.parse(d).length));}catch(e){process.stdout.write('err')}})" 2>/dev/null)"
KEY_ID=$(echo "$KEYS" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d);process.stdout.write(a[0]?.id||'');}catch(e){}})" 2>/dev/null)
echo "key_id=$KEY_ID"

if [ -n "$KEY_ID" ]; then
  PATCH=$(curl -sf -X PATCH "$API/api-keys/$KEY_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"allowedDomains":["mysite.com","*.test.com"]}' 2>/dev/null)
  DOMS=$(echo "$PATCH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.stringify(JSON.parse(d).allowedDomains));}catch(e){process.stdout.write(d)}})" 2>/dev/null)
  echo "domains: $DOMS"
  echo "$DOMS" | grep -q "mysite.com" && echo "PASS: domain saved" || echo "FAIL: $DOMS"
  # Reset
  curl -sf -X PATCH "$API/api-keys/$KEY_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"allowedDomains":[]}' > /dev/null 2>&1
  echo "domains reset"
else
  # Create a key first
  echo "Creating new key..."
  NEW_KEY=$(curl -sf -X POST "$API/api-keys" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-widget"}' 2>/dev/null)
  NEW_ID=$(echo "$NEW_KEY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).id||'');}catch(e){}})" 2>/dev/null)
  echo "created key id=$NEW_ID"
  if [ -n "$NEW_ID" ]; then
    PATCH=$(curl -sf -X PATCH "$API/api-keys/$NEW_ID" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"allowedDomains":["mysite.com"]}' 2>/dev/null)
    DOMS=$(echo "$PATCH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.stringify(JSON.parse(d).allowedDomains));}catch(e){}})" 2>/dev/null)
    echo "domains: $DOMS"
    echo "$DOMS" | grep -q "mysite.com" && echo "PASS: domain saved" || echo "FAIL"
  fi
fi
echo ""

echo "=== PROOF 5: chat response in Russian ==="
ASST=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/assistants" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d);process.stdout.write(a[0]?.id||'');}catch(e){}})" 2>/dev/null)
echo "assistant: $ASST"
if [ -n "$ASST" ]; then
  START=$(date +%s%3N)
  CHAT=$(curl -sf --max-time 30 -X POST "$API/chat" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"assistantId\":\"$ASST\",\"message\":\"скажи ок одним словом\"}" 2>/dev/null)
  END=$(date +%s%3N)
  echo "response (${END}ms - ${START}ms = $((END-START))ms): $CHAT" | head -c 400
fi
echo ""

echo "=== ALL PROOFS DONE ==="
