#!/usr/bin/env bash
set -eu
: "${TOKEN:?set TOKEN from login}"
JOB="${1:?job id}"
for i in $(seq 1 40); do
  R=$(curl -s "https://site-al.ru/api/image/status/${JOB}" -H "Authorization: Bearer ${TOKEN}")
  S=$(echo "$R" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -1)
  echo "poll $i status=$S"
  if [ "$S" = "completed" ] || [ "$S" = "failed" ]; then
    echo "$R"
    exit 0
  fi
  sleep 5
done
echo "timeout"
exit 1
