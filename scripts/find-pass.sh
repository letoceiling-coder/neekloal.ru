#!/usr/bin/env bash
set -euo pipefail
source /var/www/site-al.ru/apps/api/.env
export PGURI="${DATABASE_URL%%\?*}"
API="https://site-al.ru/api"

echo "=== Try all users ==="
for EMAIL in "test@test.com" "dsc-23@yandex.ru" "real@test.com"; do
  for PASS in "password123" "test123" "Test123" "admin123"; do
    RESULT=$(curl -s -X POST "$API/auth/login" \
      -H "Content-Type: application/json" \
      --data-binary "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
    TOKEN=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('accessToken','NOPE'))" 2>/dev/null)
    if [ "$TOKEN" != "NOPE" ] && [ -n "$TOKEN" ]; then
      echo "SUCCESS: email=$EMAIL pass=$PASS token=${TOKEN:0:20}..."
      break 2
    fi
  done
done

echo "=== bcrypt hashes for dsc-23@yandex.ru ==="
psql "$PGURI" -c "SELECT email, LEFT(password_hash,30) as hash FROM users WHERE email='dsc-23@yandex.ru';"
