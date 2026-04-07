#!/bin/bash
set -euo pipefail
# One-time: move microsocks from 1080 → 8444 (8443 on this host is occupied by telegram-bot-webhook).
sed -i 's/-p 1080/-p 8444/' /usr/local/bin/microsocks-wrap.sh
grep 8444 /usr/local/bin/microsocks-wrap.sh

echo "yes" | ufw delete allow 1080/tcp comment 'microsocks SOCKS5 tg' 2>/dev/null || true
echo "yes" | ufw delete allow 1080/tcp 2>/dev/null || true

ufw allow 8444/tcp comment 'microsocks SOCKS5 tg'

systemctl restart microsocks
sleep 1
ss -tlnp | grep 8444 || true
systemctl is-active microsocks

set -a
# shellcheck source=/dev/null
source /etc/microsocks.env
set +a
curl -sS -o /dev/null -w "socks8444_telegram %{http_code}\n" --connect-timeout 12 \
  -x "socks5://${MICROSOCKS_USER}:${MICROSOCKS_PASSWORD}@127.0.0.1:8444" https://api.telegram.org/

echo OK
