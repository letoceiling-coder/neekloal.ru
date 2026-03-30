#!/bin/bash
echo "=== ACTUAL BIG KEY ==="
redis-cli llen "laravel-database-queues:default"
redis-cli memory usage "laravel-database-queues:default"

echo ""
echo "=== SAMPLE ITEM (to understand what's in it) ==="
redis-cli lrange "laravel-database-queues:default" 0 0 | head -c 500

echo ""
echo "=== ALL KEYS WITH MEMORY USAGE ==="
redis-cli --scan | while read key; do
  MEM=$(redis-cli memory usage "$key" 2>/dev/null || echo 0)
  echo "$MEM $key"
done | sort -rn | head -20

echo ""
echo "=== TRIM laravel-database-queues:default to 0 (it's a notification list, not job data) ==="
# Check if it's just a notification list (each item is a 0 or tiny value)
SAMPLE=$(redis-cli lrange "laravel-database-queues:default" 0 2)
echo "Sample items: $SAMPLE"

# If items are single chars or tiny (notification signals), safe to clear
ITEM_LEN=$(redis-cli lrange "laravel-database-queues:default" 0 0 | wc -c)
echo "First item length: $ITEM_LEN bytes"

if [ "$ITEM_LEN" -lt 10 ]; then
  echo "Items are tiny (notification signals) — trimming to 1000"
  redis-cli ltrim "laravel-database-queues:default" 0 999
  echo "Trimmed"
else
  echo "Items have real data — NOT trimming (would break Laravel app)"
  echo "Recommendation: fix the Laravel consumer or move to separate Redis"
fi

echo ""
echo "=== MEMORY AFTER ==="
redis-cli info memory | grep -E "used_memory_human|maxmemory_human|maxmemory_policy"
redis-cli dbsize

echo ""
echo "=== SET MAXMEMORY TO 512MB (safer limit for shared Redis) ==="
redis-cli config set maxmemory 512mb
redis-cli config rewrite 2>/dev/null && echo "Config saved" || echo "Config save failed"
redis-cli config get maxmemory
