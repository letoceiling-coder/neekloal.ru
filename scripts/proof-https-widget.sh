#!/usr/bin/env bash
set -euo pipefail
SK="sk-98bf49b02de211a3967aa9d05fae8680"

echo "=== HTTPS /api/chat via X-Api-Key (no assistantId in body) ==="
printf '%s' '{"message":"Тест виджета через HTTPS"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST https://site-al.ru/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SK" \
  -H "X-Widget-Client: 1" \
  -d @-

echo ""
echo "=== HTTPS /api/chat via Authorization: Bearer sk-xxx ==="
printf '%s' '{"message":"HTTPS Bearer sk test"}' | curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST https://site-al.ru/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SK" \
  -d @-
