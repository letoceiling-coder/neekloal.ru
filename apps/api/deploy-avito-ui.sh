#!/bin/bash
set -e
cd /var/www/site-al.ru
git pull origin main 2>&1 | tail -4

echo "=== frontend build ==="
cd apps/web
npm ci 2>&1 | tail -2
npm run build 2>&1 | tail -4

echo "=== health ==="
curl -sf http://127.0.0.1:4000/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('API OK:', d.get('status'))"

echo "=== git sync ==="
cd /var/www/site-al.ru
HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
[ "$HEAD" = "$ORIGIN" ] && echo "HEAD == origin/main OK ($HEAD)" || echo "MISMATCH"

echo "=== DONE ==="
