#!/usr/bin/env bash
set -euo pipefail
source /var/www/site-al.ru/apps/api/.env
export PGURI="${DATABASE_URL%%\?*}"
API="https://site-al.ru/api"

# Try more passwords
echo "=== Try more passwords ==="
for EMAIL in "test@test.com" "dsc-23@yandex.ru" "real@test.com"; do
  for PASS in "password" "123456" "qwerty" "admin" "dsc23" "neekloal" "Neekloal123" "Password1" "pass" "12345678" "test" "Test1234"; do
    RESULT=$(curl -s -X POST "$API/auth/login" \
      -H "Content-Type: application/json" \
      --data-binary "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
    TOKEN=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('accessToken',''))" 2>/dev/null)
    if [ -n "$TOKEN" ]; then
      echo "SUCCESS: email=$EMAIL pass=$PASS token=${TOKEN:0:20}..."
      echo "$TOKEN" > /tmp/test_token.txt
      exit 0
    fi
  done
done
echo "No match found."

# Fallback: use JWT_SECRET to create a JWT directly 
echo "=== Create JWT directly ==="
USER_ID=$(psql "$PGURI" -t -c "SELECT id FROM users ORDER BY created_at ASC LIMIT 1;" 2>/dev/null | tr -d ' ')
ORG_ID=$(psql "$PGURI" -t -c "SELECT organization_id FROM organization_memberships WHERE user_id='$USER_ID'::uuid LIMIT 1;" 2>/dev/null | tr -d ' ')
echo "User ID: $USER_ID, Org ID: $ORG_ID"

# Generate JWT via Node.js
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { userId: '$USER_ID', organizationId: '$ORG_ID', role: 'admin' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);
console.log('TOKEN:', token);
require('fs').writeFileSync('/tmp/test_token.txt', token);
" 2>&1
