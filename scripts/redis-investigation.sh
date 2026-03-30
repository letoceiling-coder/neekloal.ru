#!/bin/bash
echo "=== REDIS INFO MEMORY (BEFORE) ==="
redis-cli info memory

echo ""
echo "=== REDIS DBSIZE ==="
redis-cli dbsize

echo ""
echo "=== ALL KEYS WITH TYPES AND TTL ==="
redis-cli --scan | while read key; do
  TYPE=$(redis-cli type "$key")
  TTL=$(redis-cli ttl "$key")
  SIZE=$(redis-cli object encoding "$key" 2>/dev/null || echo "?")
  echo "KEY=$key | TYPE=$TYPE | TTL=$TTL | ENC=$SIZE"
done

echo ""
echo "=== BIGKEYS SCAN ==="
redis-cli --bigkeys

echo ""
echo "=== MAXMEMORY CURRENT ==="
redis-cli config get maxmemory
redis-cli config get maxmemory-policy

echo ""
echo "=== APPLY FIX ==="
redis-cli config set maxmemory 256mb
redis-cli config set maxmemory-policy allkeys-lru
echo "CONFIG SET DONE"

echo ""
echo "=== REDIS INFO MEMORY (AFTER) ==="
redis-cli info memory | grep -E "used_memory_human|used_memory_peak_human|mem_fragmentation|maxmemory|total_connections"

echo ""
echo "=== VERIFY CONFIG ==="
redis-cli config get maxmemory
redis-cli config get maxmemory-policy
