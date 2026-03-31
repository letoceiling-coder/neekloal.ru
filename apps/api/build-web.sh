#!/bin/bash
set -e

echo "=== pwd ==="
cd /var/www/site-al.ru
pwd

echo ""
echo "=== git pull ==="
git pull origin main 2>&1 | tail -5

echo ""
echo "=== cd apps/web && npm ci ==="
cd apps/web
npm ci 2>&1 | tail -4

echo ""
echo "=== npm run build ==="
npm run build 2>&1 | tail -10

echo ""
echo "=== build done: dist/ ==="
ls -lh dist/ 2>/dev/null | head -10 || echo "(no dist/ — check build output)"

echo ""
echo "=== git sync check ==="
cd /var/www/site-al.ru
HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
echo "HEAD:        $HEAD"
echo "origin/main: $ORIGIN"
[ "$HEAD" = "$ORIGIN" ] && echo "  OK: match" || echo "  FAIL: mismatch"
