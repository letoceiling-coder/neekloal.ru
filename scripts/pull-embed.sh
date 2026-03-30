#!/usr/bin/env bash
set -euo pipefail

echo "=== Installed Ollama models ==="
curl -s http://localhost:11434/api/tags | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d.get('models', []):
    print(m['name'])
"

echo ""
echo "=== Pull nomic-embed-text ==="
curl -s -X POST http://localhost:11434/api/pull \
  -H "Content-Type: application/json" \
  -d '{"name":"nomic-embed-text","stream":false}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('status:', d.get('status',''))"

echo ""
echo "=== Test nomic-embed-text ==="
RESP=$(curl -s -X POST http://localhost:11434/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"nomic-embed-text","prompt":"hello world"}')
DIM=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('embedding',[])))")
echo "Embedding dimension: $DIM"
