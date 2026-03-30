#!/usr/bin/env bash
# Run ON Linux server: bash server-proof-db.sh
set -euo pipefail
cd /var/www/site-al.ru/apps/api
set -a
# shellcheck disable=SC1091
source .env
set +a
# psql rejects ?schema= in URI
export PGURI="${DATABASE_URL%%\?*}"

ORG_ID="654a1dbf-7ad9-4acd-bddc-6e4480bc1053"
AID="d33745d3-18a5-4d67-ae61-16115111aeb5"
EMAIL="${PROOF_EMAIL:-proof-1774809755@example.com}"
PASS="${PROOF_PASSWORD:-TestPass99}"
LOGIN_JSON=$(curl -sS -X POST http://127.0.0.1:4000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN=$(echo "$LOGIN_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.accessToken||'');}catch(e){process.exit(1);}})")
if [ -z "$TOKEN" ]; then echo "login failed: $LOGIN_JSON"; exit 1; fi

echo "=== STEP 5: usage rows (last 5) ==="
psql "$PGURI" -c 'SELECT id, organization_id, user_id, assistant_id, model, tokens, created_at FROM "usage" ORDER BY created_at DESC LIMIT 5;'

echo ""
FREE_PLAN=$(psql "$PGURI" -tAc "SELECT plan_id FROM organizations WHERE id = '$ORG_ID'")
SLUG="pz-$(openssl rand -hex 5)"
echo "=== STEP 7: clone plan with max_requests_per_month=0, assign org $ORG_ID ==="
psql "$PGURI" -v ON_ERROR_STOP=1 -c "
INSERT INTO plans (id, slug, name, max_requests_per_month, max_tokens_per_month, allowed_models, created_at, updated_at)
SELECT gen_random_uuid(), '$SLUG', 'Proof zero', 0, max_tokens_per_month, allowed_models, now(), now()
FROM plans WHERE id = '$FREE_PLAN'::uuid;
"
NEW_PLAN=$(psql "$PGURI" -tAc "SELECT id FROM plans WHERE slug = '$SLUG' LIMIT 1;")
echo "new_plan_id=$NEW_PLAN"
psql "$PGURI" -c "UPDATE organizations SET plan_id = '$NEW_PLAN'::uuid WHERE id = '$ORG_ID'::uuid;"

echo ""
echo "=== STEP 7: POST /chat (expect HTTP 402) ==="
printf '%s' "{\"assistantId\":\"$AID\",\"message\":\"test\"}" | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST http://127.0.0.1:4000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @-

echo ""
echo "=== revert org plan + drop proof plan ==="
psql "$PGURI" -c "UPDATE organizations SET plan_id = '$FREE_PLAN'::uuid WHERE id = '$ORG_ID'::uuid;"
psql "$PGURI" -c "DELETE FROM plans WHERE slug = '$SLUG';"
