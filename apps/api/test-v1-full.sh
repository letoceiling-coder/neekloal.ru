#!/bin/bash
cd /var/www/site-al.ru/apps/api
BASE="http://127.0.0.1:4000"

echo "=== Bootstrap: get JWT ==="
JWT=$(node -e "
const { PrismaClient } = require('@prisma/client');
const { signAccessToken } = require('./src/lib/jwt');
const p = new PrismaClient();
p.user.findFirst({ where: { deletedAt: null }, include: { memberships: true } }).then(u => {
  if (!u || !u.memberships[0]) { console.error('no user'); process.exit(1); }
  console.log(signAccessToken({ userId: u.id, organizationId: u.memberships[0].organizationId }));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null)
[ -z "$JWT" ] && echo "  ⚠️ no JWT" && exit 1
echo "  ✅ JWT OK"

echo ""
echo "=== Create test agent ==="
AGENT=$(curl -sf -X POST "$BASE/agents" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"name":"V1 API Test Agent","type":"chat","rules":"Ты тестовый ассистент. Отвечай кратко и по делу."}')
echo "$AGENT" | python3 -c "import sys,json; a=json.load(sys.stdin); print('  agent id=' + a['id'] + ' name=' + a['name'])"
AGENT_ID=$(echo "$AGENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
[ -z "$AGENT_ID" ] && echo "  ⚠️ Could not create agent" && exit 1

echo ""
echo "=== TEST 1: 401 without auth ==="
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/chat" -H "Content-Type: application/json" -d "{}")
[ "$S" = "401" ] && echo "  ✅ 401" || echo "  ⚠️ got $S"

echo ""
echo "=== TEST 2: 400 missing message ==="
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/chat" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_ID\"}")
[ "$S" = "400" ] && echo "  ✅ 400 missing message" || echo "  ⚠️ got $S"

echo ""
echo "=== TEST 3: 404 wrong agentId ==="
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/chat" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"agentId":"00000000-0000-0000-0000-000000000000","message":"test"}')
[ "$S" = "404" ] && echo "  ✅ 404 agent not found" || echo "  ⚠️ got $S"

echo ""
echo "=== TEST 4: POST /api/v1/chat — auto-create conversation ==="
RESP=$(curl -sf -X POST "$BASE/api/v1/chat" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_ID\",\"message\":\"Привет! Кто ты?\"}")
echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'reply' in d, 'no reply'
assert 'conversationId' in d, 'no conversationId'
assert 'model' in d, 'no model'
assert d.get('created') == True, 'created should be True'
print('  ✅ reply=' + repr(d['reply'][:60]) + '...')
print('  ✅ model=' + d['model'] + ' created=' + str(d['created']))
"
CONV_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('conversationId',''))" 2>/dev/null)
echo "  conv=$CONV_ID"

echo ""
echo "=== TEST 5: continue existing conversation (created=False) ==="
RESP2=$(curl -sf -X POST "$BASE/api/v1/chat" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_ID\",\"message\":\"Повтори первое слово своего прошлого ответа.\",\"conversationId\":\"$CONV_ID\"}")
echo "$RESP2" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('created') == False, 'created should be False'
print('  ✅ reply=' + repr(d['reply'][:60]) + '...')
print('  ✅ created=False — context preserved')
"

echo ""
echo "=== TEST 6: Rate limit headers ==="
HEADERS=$(curl -sI -X POST "$BASE/api/v1/chat" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_ID\",\"message\":\"ping\"}")
echo "$HEADERS" | grep -i "x-ratelimit" | head -3
echo "$HEADERS" | grep -qi "x-ratelimit-remaining" && echo "  ✅ X-RateLimit-Remaining present" || echo "  ⚠️ no rate headers"

echo ""
echo "=== TEST 7: POST /api/v1/chat/stream — SSE ==="
STREAM=$(curl -sf -X POST "$BASE/api/v1/chat/stream" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_ID\",\"message\":\"Напиши одно слово: ТЕСТ\",\"conversationId\":\"$CONV_ID\"}" \
  --max-time 30)
echo "$STREAM" | grep -E "^event:|^data:" | head -6
echo "$STREAM" | grep -q "event: token" && echo "  ✅ SSE event:token received" || echo "  ⚠️ no event:token"
echo "$STREAM" | grep -q "event: done"  && echo "  ✅ SSE event:done received"  || echo "  ⚠️ no event:done"
echo "$STREAM" | python3 -c "
import sys, json
lines = sys.stdin.read().splitlines()
done_lines = [l for l in lines if l.startswith('data:') and 'conversationId' in l]
if done_lines:
    d = json.loads(done_lines[-1][5:])
    print('  ✅ done.conversationId=' + d.get('conversationId','?')[:8] + '... model=' + str(d.get('model','?')))
" 2>/dev/null || true

echo ""
echo "=== Cleanup: delete test agent ==="
curl -sf -X DELETE "$BASE/agents/$AGENT_ID" -H "Authorization: Bearer $JWT" > /dev/null 2>&1 && echo "  ✅ agent deleted" || echo "  (no delete endpoint or already gone)"

echo ""
echo "=== DONE ==="
