#!/usr/bin/env bash
set -euo pipefail
source /var/www/site-al.ru/apps/api/.env
export PGURI="${DATABASE_URL%%\?*}"

# Find admin user
echo "=== Users in DB ==="
psql "$PGURI" -c "SELECT id, email, created_at FROM users ORDER BY created_at ASC LIMIT 5;"
