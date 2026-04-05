#!/usr/bin/env bash
# Requires: export TOKEN="<JWT from POST /auth/login>"
set -eu
: "${TOKEN:?set TOKEN from login}"
REF="${1:-https://site-al.ru/uploads/refs/d84c0135-7a91-4aa2-a922-7614e108a8c9.jpg}"
curl -s -X POST "https://site-al.ru/api/image/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"mode\":\"product\",\"prompt\":\"fashion studio photo, soft lighting, neutral background\",\"referenceImageUrl\":\"${REF}\",\"strength\":0.45,\"ipAdapterWeight\":0.55,\"width\":1024,\"height\":1024,\"smartMode\":false}"
