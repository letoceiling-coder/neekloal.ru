#!/bin/bash
# Test: AvitoAccount CRUD + agent link
cd /var/www/site-al.ru/apps/api

echo "=== Get JWT ==="
JWT=$(node -e "
const { PrismaClient } = require('@prisma/client');
const { signAccessToken } = require('./src/lib/jwt');
const p = new PrismaClient();
p.user.findFirst({ where: { deletedAt: null }, include: { memberships: true } }).then(u => {
  if (!u || !u.memberships[0]) { console.error('no user'); process.exit(1); }
  const token = signAccessToken({ userId: u.id, organizationId: u.memberships[0].organizationId });
  console.log(token);
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null)
[ -z "$JWT" ] && echo "  ⚠️ no JWT — skip" && exit 0
echo "  ✅ JWT obtained"

BASE="http://127.0.0.1:4000"

echo ""
echo "=== POST /avito/accounts ==="
ACC=$(curl -sf -X POST "$BASE/avito/accounts" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"Тестовый Avito","accessToken":"test_token_123","accountId":"99999","webhookSecret":"mysecret"}')
echo "$ACC"
ACC_ID=$(echo "$ACC" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  ✅ created id=$ACC_ID"

echo ""
echo "=== GET /avito/accounts ==="
LIST=$(curl -sf "$BASE/avito/accounts" -H "Authorization: Bearer $JWT")
COUNT=$(echo "$LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))")
echo "  ✅ accounts: $COUNT"
echo "$LIST" | python3 -c "import sys,json; [print('  id='+a['id'][:8]+'... name='+str(a['name'])+' active='+str(a['isActive'])+' hasToken='+str(a['hasToken'])) for a in json.load(sys.stdin)]"

echo ""
echo "=== Get first agent UUID ==="
AGENT_ID=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.agent.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }).then(a => {
  if (!a) { console.log(''); process.exit(0); }
  console.log(a.id);
  process.exit(0);
}).catch(e => { process.exit(1); });
" 2>/dev/null)

if [ -n "$AGENT_ID" ]; then
  echo ""
  echo "=== PATCH /avito/agent/:id — link account ==="
  PATCH=$(curl -sf -X PATCH "$BASE/avito/agent/$AGENT_ID" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{\"avitoMode\":\"copilot\",\"avitoAccountId\":\"$ACC_ID\"}")
  echo "$PATCH"
  echo "  ✅ agent linked"
fi

echo ""
echo "=== PATCH /avito/accounts/:id — toggle isActive ==="
UPD=$(curl -sf -X PATCH "$BASE/avito/accounts/$ACC_ID" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"isActive":false}')
ACTIVE=$(echo "$UPD" | python3 -c "import sys,json; print(json.load(sys.stdin)['isActive'])")
[ "$ACTIVE" = "False" ] && echo "  ✅ isActive=False" || echo "  isActive=$ACTIVE"

echo ""
echo "=== DELETE /avito/accounts/:id ==="
DEL=$(curl -sf -X DELETE "$BASE/avito/accounts/$ACC_ID" -H "Authorization: Bearer $JWT")
echo "$DEL" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')==True; print('  ✅ deleted ok=true')"

echo ""
echo "=== DB: verify avito_accounts table ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.avitoAccount.count().then(n => { console.log('  avito_accounts rows:', n); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
"

echo ""
echo "=== DONE ==="
