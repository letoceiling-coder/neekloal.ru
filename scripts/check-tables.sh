#!/usr/bin/env bash
set -euo pipefail
set -o allexport
source /var/www/site-al.ru/apps/api/.env
set +o allexport
export PGURI="${DATABASE_URL%%\?*}"
echo "Tables:"
psql "$PGURI" -tAc "\dt"
echo "---"
echo "usages table columns:"
psql "$PGURI" -tAc "\d usage" 2>&1 || psql "$PGURI" -tAc "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='usages' OR table_name='usage' ORDER BY table_name, ordinal_position;" 2>&1 || true
