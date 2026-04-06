#!/bin/bash
# READ-ONLY system audit — NO changes, NO restarts
SEP="============================================================"

echo "$SEP"
echo "STEP 1 — PM2 STATE"
echo "$SEP"
pm2 list
echo "--- pm2 show ai-api ---"
pm2 show ai-api 2>/dev/null
echo "--- pm2 logs ai-api (last 60 lines) ---"
pm2 logs ai-api --lines 60 --nostream 2>/dev/null

echo "$SEP"
echo "STEP 2 — SYSTEM RESOURCES"
echo "$SEP"
echo "--- RAM ---"
free -m
echo "--- CPU/TOP ---"
top -b -n1 | head -25
echo "--- DISK ---"
df -h

echo "$SEP"
echo "STEP 3 — ZOMBIE PROCESSES"
echo "$SEP"
ps aux | grep defunct | grep -v grep || echo "NO ZOMBIES"
echo "--- process count ---"
ps aux | wc -l

echo "$SEP"
echo "STEP 4 — OPEN PORTS"
echo "$SEP"
ss -tulnp

echo "$SEP"
echo "STEP 5 — NGINX"
echo "$SEP"
nginx -t 2>&1

echo "$SEP"
echo "STEP 6 — REDIS STATE"
echo "$SEP"
echo "--- memory ---"
redis-cli info memory 2>/dev/null | grep -E "used_memory_human|maxmemory_human|mem_fragmentation_ratio|maxmemory_policy"
echo "--- stats ---"
redis-cli info stats 2>/dev/null | grep -E "keyspace_hits|keyspace_misses|evicted_keys|total_commands_processed|connected_clients"
echo "--- keyspace ---"
redis-cli info keyspace 2>/dev/null

echo "$SEP"
echo "STEP 7 — API HEALTH"
echo "$SEP"
curl -s http://localhost:4000/health || curl -s http://localhost:4000/api/health || echo "API NOT RESPONDING"
echo ""
echo "--- api ping ---"
curl -s -o /dev/null -w "HTTP:%{http_code} time:%{time_total}s" http://localhost:4000/health
echo ""

echo "$SEP"
echo "STEP 8b — UPLOADS (SIZE)"
echo "$SEP"
du -sh /var/www/site-al.ru/uploads/ 2>/dev/null

echo "$SEP"
echo "STEP 9 — PM2 QUEUE WORKERS"
echo "$SEP"
pm2 show image-worker 2>/dev/null || echo "image-worker: not in pm2 (runs inline)"
pm2 logs image-worker --lines 20 --nostream 2>/dev/null || echo "no image-worker logs"

echo "$SEP"
echo "AUDIT COMPLETE — $(date)"
echo "$SEP"
