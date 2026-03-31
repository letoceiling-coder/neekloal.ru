#!/bin/bash
set -e

echo "STEP 1 — CHECK GIT STATUS"
git status
if [[ -n $(git status --porcelain) ]]; then
  echo "❌ ERROR: Uncommitted changes"
  exit 1
fi

echo "STEP 2 — PUSH"
git pull origin main
git push origin main

echo "STEP 3 — SERVER DEPLOY"
ssh root@89.169.39.244 << 'EOF'
cd /var/www/site-al.ru

echo "→ GIT PULL"
git pull origin main

echo "→ BUILD FRONTEND"
cd apps/web
npm ci
npm run build

echo "→ RESTART API"
cd ../api
pm2 restart ai-api
pm2 save

echo "→ VERIFY BUILD"
grep -n "Создайте своё первое видео" /var/www/site-al.ru/apps/web/dist/assets/*.js || exit 1

echo "✅ DEPLOY OK"
EOF
