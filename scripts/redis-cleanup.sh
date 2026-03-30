#!/bin/bash
echo "=== BEFORE CLEANUP ==="
redis-cli info memory | grep -E "used_memory_human|used_memory_peak"
redis-cli dbsize

echo ""
echo "=== COMPLETED BULLMQ JOBS (rag-processing) ==="
# List all completed job hashes
redis-cli --scan --pattern 'bull:rag-processing:*' | grep -E '^bull:rag-processing:[0-9]+$' | while read key; do
  STATE=$(redis-cli hget "$key" "finishedOn" 2>/dev/null)
  if [ -n "$STATE" ]; then
    echo "COMPLETED JOB: $key (finishedOn=$STATE)"
  fi
done

echo ""
echo "=== LARAVEL QUEUE SIZES ==="
redis-cli llen "laravel-database-queues:default"
redis-cli llen "laravel-database-queues:default:notify"
redis-cli llen "laravel-database-queues:parse"
redis-cli zcard "laravel-database-queues:parse:reserved"

echo ""
echo "=== DELETE COMPLETED BULLMQ JOBS ==="
# BullMQ completed jobs zset — already tracked, individual hashes can be removed
redis-cli --scan --pattern 'bull:rag-processing:completed' | while read key; do
  echo "Completed zset members:"
  redis-cli zrange "$key" 0 -1
done

# Remove individual job hashes that are completed (have finishedOn)
DELETED=0
for i in $(seq 1 30); do
  KEY="bull:rag-processing:$i"
  EXISTS=$(redis-cli exists "$KEY")
  if [ "$EXISTS" = "1" ]; then
    FINISHED=$(redis-cli hget "$KEY" "finishedOn" 2>/dev/null)
    FAILED=$(redis-cli hget "$KEY" "failedReason" 2>/dev/null)
    if [ -n "$FINISHED" ] || [ -n "$FAILED" ]; then
      redis-cli del "$KEY" > /dev/null
      DELETED=$((DELETED+1))
    fi
  fi
done
echo "Deleted $DELETED completed/failed job hashes"

echo ""
echo "=== DELETE COMPLETED ZSET ==="
redis-cli del "bull:rag-processing:completed"

echo ""
echo "=== TRIM LARAVEL NOTIFY LIST (cap at 1000) ==="
LLEN=$(redis-cli llen "laravel-database-queues:default:notify")
echo "laravel-database-queues:default:notify current length: $LLEN"
if [ "$LLEN" -gt 1000 ]; then
  redis-cli ltrim "laravel-database-queues:default:notify" 0 999
  echo "Trimmed to 1000 items"
fi

echo ""
echo "=== TRIM LARAVEL PARSE LIST ==="
PLEN=$(redis-cli llen "laravel-database-queues:parse")
echo "laravel-database-queues:parse current length: $PLEN"

echo ""
echo "=== MEMORY AFTER CLEANUP ==="
redis-cli memory usage "laravel-database-queues:default:notify" 2>/dev/null || echo "key may be gone"
redis-cli info memory | grep -E "used_memory_human|used_memory_peak_human|maxmemory_human|maxmemory_policy"
redis-cli dbsize

echo ""
echo "=== REDIS CONFIG PERSIST (save to redis.conf) ==="
redis-cli config rewrite 2>/dev/null && echo "Config rewritten to disk" || echo "Config rewrite not available (no config file path)"
