#!/bin/bash
echo "=== PM2 DESCRIBE ==="
pm2 describe ai-api

echo ""
echo "=== PM2 ERROR LOGS (last 150 lines) ==="
pm2 logs ai-api --lines 150 --nostream --err

echo ""
echo "=== PM2 OUT LOGS (last 50 lines) ==="
pm2 logs ai-api --lines 50 --nostream --out

echo ""
echo "=== DMESG (last 50 lines) ==="
dmesg | tail -n 50

echo ""
echo "=== MEMORY ==="
free -m

echo ""
echo "=== TOP SNAPSHOT ==="
top -b -n 1 | head -n 25

echo ""
echo "=== OLLAMA CHECK ==="
curl -s --max-time 5 http://188.124.55.89:11434/api/tags | head -c 300 || echo "OLLAMA UNREACHABLE"

echo ""
echo "=== QDRANT CHECK ==="
curl -s --max-time 5 http://188.124.55.89:6333/collections || echo "QDRANT UNREACHABLE"

echo ""
echo "=== REDIS CHECK ==="
redis-cli ping

echo ""
echo "=== REDIS INFO MEMORY ==="
redis-cli info memory | grep -E "used_memory_human|mem_fragmentation"

echo ""
echo "=== POSTGRES CONNECTIONS ==="
psql "postgresql://ai_user:e2be1c4776d8e8c00e03ae5214fccf9afc9cc549f2f272ffd192f24a5857c359@localhost:5432/neekloal_saas" -c "SELECT count(*) as total_connections, state, wait_event_type FROM pg_stat_activity GROUP BY state, wait_event_type ORDER BY total_connections DESC;" 2>&1 || echo "PSQL FAILED"

echo ""
echo "=== POSTGRES MAX CONN ==="
psql "postgresql://ai_user:e2be1c4776d8e8c00e03ae5214fccf9afc9cc549f2f272ffd192f24a5857c359@localhost:5432/neekloal_saas" -c "SHOW max_connections;" 2>&1 || echo "PSQL FAILED"

echo ""
echo "=== PM2 RAW LOG FILES ==="
ls -la /root/.pm2/logs/ | grep ai-api

echo ""
echo "=== DIRECT ERROR LOG (tail 100) ==="
tail -100 /root/.pm2/logs/ai-api-error.log 2>/dev/null || echo "ERROR LOG NOT FOUND"

echo ""
echo "=== DIRECT OUT LOG (tail 100) ==="
tail -100 /root/.pm2/logs/ai-api-out.log 2>/dev/null || echo "OUT LOG NOT FOUND"
