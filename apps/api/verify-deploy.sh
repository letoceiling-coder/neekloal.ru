#!/bin/bash
set -e

echo "=== pwd ==="
cd /var/www/site-al.ru
pwd

echo ""
echo "=== git sync (HEAD vs origin/main) ==="
git fetch origin -q
HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
echo "HEAD:         $HEAD"
echo "origin/main:  $ORIGIN"
if [ "$HEAD" = "$ORIGIN" ]; then echo "  OK: hashes match"; else echo "  MISMATCH - STOP"; fi

echo ""
echo "=== git status ==="
git status --short && echo "  OK: clean"

echo ""
echo "=== npm ci (required by rule 7) ==="
cd apps/api
npm ci 2>&1 | tail -3

echo ""
echo "=== pm2 restart + save ==="
pm2 restart ai-api
pm2 save
sleep 3

echo ""
echo "=== health: localhost ==="
curl -sf http://127.0.0.1:4000/health && echo " OK"

echo ""
echo "=== health: https://site-al.ru/api/health ==="
curl -sf https://site-al.ru/api/health && echo " OK"

echo ""
echo "=== pm2 cwd verify ==="
pm2 describe ai-api | grep cwd

echo ""
echo "=== pm2 count (must be 1) ==="
COUNT=$(pm2 list | grep ai-api | wc -l)
echo "$COUNT"
[ "$COUNT" -eq 1 ] && echo "  OK" || echo "  FAIL: more than 1 ai-api process"

echo ""
echo "=== port 4000 ==="
ss -tulnp | grep 4000

echo ""
echo "=== nginx test ==="
nginx -t 2>&1 | tail -2

echo ""
echo "=== ollama tags ==="
curl -sf http://188.124.55.89:11434/api/tags | python3 -c "import sys,json; d=json.load(sys.stdin); print('  models:', len(d['models']), '- OK')"

echo ""
echo "=== DEPLOY COMPLETE ==="
