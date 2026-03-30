#!/bin/bash
echo "=== NGINX SITES ==="
ls /etc/nginx/sites-enabled/

echo ""
echo "=== SITE-AL.RU NGINX ==="
cat /etc/nginx/sites-enabled/site-al.ru

echo ""
echo "=== AI-API NGINX (if exists) ==="
cat /etc/nginx/sites-enabled/ai-api 2>/dev/null || echo "NOT FOUND"

echo ""
echo "=== ENV (masked) ==="
grep -E "^(DATABASE_URL|REDIS|OLLAMA|QDRANT|PORT|DEFAULT_MODEL|JWT_SECRET)" /var/www/site-al.ru/apps/api/.env 2>/dev/null | sed 's/\(PASSWORD\|SECRET\|KEY\)=.*/\1=***/'

echo ""
echo "=== PROJECT STRUCTURE ==="
find /var/www/site-al.ru -maxdepth 3 -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" | sort

echo ""
echo "=== API PACKAGE.JSON ==="
cat /var/www/site-al.ru/apps/api/package.json | grep -E '"(name|version|main|fastify|express|nestjs)"'

echo ""
echo "=== API ROUTES LIST ==="
ls /var/www/site-al.ru/apps/api/src/routes/

echo ""
echo "=== API SERVICES LIST ==="
ls /var/www/site-al.ru/apps/api/src/services/ 2>/dev/null || echo "NOT FOUND"

echo ""
echo "=== API WORKERS LIST ==="
ls /var/www/site-al.ru/apps/api/src/workers/ 2>/dev/null || echo "NOT FOUND"

echo ""
echo "=== REDIS PING ==="
redis-cli ping

echo ""
echo "=== REDIS KEYS COUNT ==="
redis-cli dbsize

echo ""
echo "=== POSTGRES DB ==="
psql -U postgres -c "\l" 2>/dev/null | grep -v "^$" | head -20 || echo "psql not accessible as root"

echo ""
echo "=== QDRANT CHECK ==="
curl -s http://188.124.55.89:6333/collections | head -c 500
