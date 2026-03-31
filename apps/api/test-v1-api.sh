#!/bin/bash
# Test /api/v1/chat + /api/v1/chat/stream
cd /var/www/site-al.ru/apps/api

BASE="http://127.0.0.1:4000"

echo "=== Get JWT + first agentId ==="
CREDS=$(node -e "
const { PrismaClient } = require('@prisma/client');
const { signAccessToken } = require('./src/lib/jwt');
const p = new PrismaClient();
async function main() {
  const u = await p.user.findFirst({ where: { deletedAt: null }, include: { memberships: true } });
  if (!u || !u.memberships[0]) { console.log('NO_USER'); process.exit(1); }
  const orgId = u.memberships[0].organizationId;
  const token = signAccessToken({ userId: u.id, organizationId: orgId });
  const agent = await p.agent.findFirst({ where: { organizationId: orgId, deletedAt: null } });
  console.log(token + '|' + (agent ? agent.id : ''));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null)
JWT="${CREDS%%|*}"
AGENT_ID="${CREDS##*|}"
[ -z "$JWT" ] && echo "⚠️ No JWT" && exit 0
[ -z "$AGENT_ID" ] && echo "⚠️ No agent in DB — create one first" && exit 0
echo "  JWT: OK"
echo "  agentId: $AGENT_ID"

echo ""
echo "=== TEST 1: 401 without auth ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/chat" -H "Content-Type: application/json" -d '{}')
[ "$STATUS" = "401" ] && echo "  ✅ 401 without auth" || echo "  ⚠️  expected 401, got $STATUS"

echo ""
echo "=== TEST 2: 400 missing message ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/chat" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_ID\"}")
[ "$STATUS" = "400" ] && echo "  ✅ 400 missing message" || echo "  ⚠️  expected 400, got $STATUS"

echo ""
echo "=== TEST 3: POST /api/v1/chat — auto-create conversation ==="
RESP=$(curl -sf -X POST "$BASE/api/v1/chat" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_ID\",\"message\":\"Привет! Расскажи кратко кто ты.\"}")
echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'reply' in d,          'no reply field'
assert 'conversationId' in d, 'no conversationId'
assert 'model' in d,          'no model'
assert d.get('created') == True, 'created should be True for new conv'
print('  ✅ reply chars=' + str(len(d['reply'])) + ' model=' + d['model'] + ' conv=' + d['conversationId'][:8] + '... created=' + str(d['created']))
CONV_ID = d['conversationId']
" 2>&1
CONV_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['conversationId'])" 2>/dev/null)

echo ""
echo "=== TEST 4: POST /api/v1/chat — continue existing conversation ==="
if [ -n "$CONV_ID" ]; then
  RESP2=$(curl -sf -X POST "$BASE/api/v1/chat" \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    -d "{\"agentId\":\"$AGENT_ID\",\"message\":\"Отлично. Напомни как тебя зовут.\",\"conversationId\":\"$CONV_ID\"}")
  echo "$RESP2" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('created') == False, 'created should be False for existing conv'
print('  ✅ reply chars=' + str(len(d['reply'])) + ' created=False conv continues')
" 2>&1
fi

echo ""
echo "=== TEST 5: 404 wrong agentId ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/chat" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"agentId":"00000000-0000-0000-0000-000000000000","message":"test"}')
[ "$STATUS" = "404" ] && echo "  ✅ 404 agent not found" || echo "  ⚠️  expected 404, got $STATUS"

echo ""
echo "=== TEST 6: POST /api/v1/chat/stream — SSE response ==="
if [ -n "$CONV_ID" ]; then
  STREAM=$(curl -sf -X POST "$BASE/api/v1/chat/stream" \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    -d "{\"agentId\":\"$AGENT_ID\",\"message\":\"Скажи только: OK\",\"conversationId\":\"$CONV_ID\"}" \
    --max-time 30 2>&1)
  echo "$STREAM" | grep -E "^event:|^data:" | head -8
  echo "$STREAM" | grep -q "event: done" && echo "  ✅ SSE event:done received" || echo "  ⚠️  no event:done in stream"
  echo "$STREAM" | grep -q "event: token" && echo "  ✅ SSE event:token received" || echo "  ⚠️  no event:token in stream"
fi

echo ""
echo "=== Rate limit headers present? ==="
HEADERS=$(curl -sI -X POST "$BASE/api/v1/chat" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_ID\",\"message\":\"ping\"}" 2>/dev/null)
echo "$HEADERS" | grep -i "x-ratelimit" | head -3
echo "$HEADERS" | grep -qi "x-ratelimit" && echo "  ✅ rate limit headers present" || echo "  ⚠️  no rate limit headers"

echo ""
echo "=== DONE ==="
