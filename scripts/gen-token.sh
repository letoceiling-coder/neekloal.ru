#!/usr/bin/env bash
set -euo pipefail
source /var/www/site-al.ru/apps/api/.env
export PGURI="${DATABASE_URL%%\?*}"

echo "=== User and org info ==="
USER_ID=$(psql "$PGURI" -t -c "SELECT id FROM users WHERE email='dsc-23@yandex.ru';" 2>/dev/null | tr -d ' ')
ORG_ID=$(psql "$PGURI" -t -c "SELECT organization_id FROM organization_memberships WHERE user_id='$USER_ID'::uuid LIMIT 1;" 2>/dev/null | tr -d ' ')
echo "User: $USER_ID Org: $ORG_ID"

echo "=== Existing API keys ==="
psql "$PGURI" -c "SELECT id, name, LEFT(key_hash,20) as key_hash, assistant_id FROM api_keys ORDER BY created_at DESC LIMIT 5;" 2>/dev/null

cd /var/www/site-al.ru/apps/api
echo "=== Generate JWT ==="
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { userId: '$USER_ID', organizationId: '$ORG_ID', role: 'owner' },
  process.env.JWT_SECRET,
  { expiresIn: '2h' }
);
console.log(token);
require('fs').writeFileSync('/tmp/test_token.txt', token);
process.exit(0);
" 2>&1
echo "=== Token saved to /tmp/test_token.txt ==="
cat /tmp/test_token.txt | head -c 50
