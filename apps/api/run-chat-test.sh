#!/bin/bash
cd /var/www/site-al.ru/apps/api
TOK=$(node tok.js 2>/dev/null | tail -1)
echo "Token length: ${#TOK}"
TEST_TOKEN="$TOK" node test-agent-chat.js
