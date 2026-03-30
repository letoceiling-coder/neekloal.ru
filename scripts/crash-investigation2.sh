#!/bin/bash
echo "=== MEMORY ==="
free -m

echo ""
echo "=== TOP SNAPSHOT ==="
top -b -n 1 | head -n 25

echo ""
echo "=== OLLAMA CHECK ==="
curl -s --max-time 5 http://188.124.55.89:11434/api/tags | python3 -c "import sys,json; d=json.load(sys.stdin); [print(m['name']) for m in d.get('models',[])]" 2>/dev/null || echo "OLLAMA UNREACHABLE"

echo ""
echo "=== QDRANT CHECK ==="
curl -s --max-time 5 http://188.124.55.89:6333/collections

echo ""
echo "=== REDIS CHECK ==="
redis-cli ping
redis-cli info memory | grep used_memory_human

echo ""
echo "=== POSTGRES CONNECTIONS ==="
psql "postgresql://ai_user:e2be1c4776d8e8c00e03ae5214fccf9afc9cc549f2f272ffd192f24a5857c359@localhost:5432/neekloal_saas" -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;" 2>&1

echo ""
echo "=== POSTGRES MAX CONN ==="
psql "postgresql://ai_user:e2be1c4776d8e8c00e03ae5214fccf9afc9cc549f2f272ffd192f24a5857c359@localhost:5432/neekloal_saas" -c "SHOW max_connections;" 2>&1

echo ""
echo "=== PM2 LOG FILES SIZE ==="
ls -lh /root/.pm2/logs/ai-api* 2>/dev/null

echo ""
echo "=== HISTORICAL ERROR LOG (last 200 lines) ==="
tail -200 /root/.pm2/logs/ai-api-error.log 2>/dev/null || echo "EMPTY or NOT FOUND"

echo ""
echo "=== TCP ORPHAN SOCKETS COUNT ==="
cat /proc/sys/net/ipv4/tcp_max_orphans
ss -s

echo ""
echo "=== DMESG FULL TCP + OOM ==="
dmesg | grep -E "TCP: too many orphaned|OOM|killed|out of memory" | tail -30

echo ""
echo "=== APP.JS ENTRY ==="
head -60 /var/www/site-al.ru/apps/api/src/app.js

echo ""
echo "=== PM2 ECOSYSTEM (if exists) ==="
cat /var/www/site-al.ru/infra/pm2.ecosystem.config.cjs 2>/dev/null | head -50

echo ""
echo "=== NODE MAX OLD SPACE ==="
node --max-old-space-size 2>/dev/null; node -e "console.log('heap limit MB:', require('v8').getHeapStatistics().heap_size_limit/1024/1024)"
