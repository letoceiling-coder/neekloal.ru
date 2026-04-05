#!/bin/bash
# READ-ONLY GPU server audit
SEP="============================================================"

echo "$SEP"
echo "STEP 8 — GPU SERVER STATE"
echo "$SEP"
echo "--- nvidia-smi ---"
nvidia-smi

echo "--- GPU memory detail ---"
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,temperature.gpu,power.draw --format=csv,noheader

echo "--- GPU compute processes ---"
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null

echo "$SEP"
echo "STEP 8c — OLLAMA STATE"
echo "$SEP"
curl -s http://localhost:11434/api/ps 2>/dev/null || echo "Ollama API not responding"
echo ""
curl -s http://localhost:11434/api/tags 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); [print(m['name'], m.get('size','?')) for m in d.get('models',[])]" 2>/dev/null || echo "tags: not available"

echo "$SEP"
echo "STEP 9 — DOCKER STATE"
echo "$SEP"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"

echo "--- docker stats (one-shot) ---"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null

echo "$SEP"
echo "STEP 9b — comfyui logs"
echo "$SEP"
docker logs comfyui --tail 20 2>&1

echo "$SEP"
echo "GPU SERVER AUDIT COMPLETE — $(date)"
echo "$SEP"
