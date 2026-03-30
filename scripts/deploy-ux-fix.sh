#!/usr/bin/env bash
set -e
cd /var/www/site-al.ru

echo "=== git pull ==="
git pull origin main

echo "=== pm2 restart api ==="
cd apps/api
pm2 restart ai-api
cd /var/www/site-al.ru

echo "=== build frontend ==="
cd apps/web
npm ci --prefer-offline
npm run build

echo "=== copy widget.js to dist ==="
# widget.js is served from the web dist folder by nginx
cp /var/www/site-al.ru/apps/widget/widget.js /var/www/site-al.ru/apps/web/dist/widget.js
echo "widget.js copied"

echo "=== nginx reload ==="
nginx -t && systemctl reload nginx

echo "=== DONE ==="
