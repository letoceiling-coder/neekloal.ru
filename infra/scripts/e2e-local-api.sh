#!/usr/bin/env bash
set -eu
BASE="${1:-http://127.0.0.1:4000}"
U=$(curl -sS -X POST "$BASE/users" -H "Content-Type: application/json" -d '{"email":"e2e-'$(date +%s)'@t.com"}')
echo "USER: $U"
USER_ID=$(echo "$U" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
K=$(curl -sS -X POST "$BASE/api-keys" -H "Content-Type: application/json" -d "{\"userId\":\"$USER_ID\"}")
echo "KEY_RESP: $K"
KEY=$(echo "$K" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])")
curl -sS "$BASE/assistants" -H "Authorization: Bearer $KEY"
echo
