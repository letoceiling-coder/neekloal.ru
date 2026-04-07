#!/bin/bash
set -euo pipefail
NEW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 22)
echo "MICROSOCKS_USER=tgproxy" > /etc/microsocks.env
echo "MICROSOCKS_PASSWORD=${NEW}" >> /etc/microsocks.env
chmod 600 /etc/microsocks.env
systemctl restart microsocks
{
  echo "SOCKS5 89.169.39.244:1080"
  echo "User: tgproxy"
  echo "Password: ${NEW}"
  echo ""
  echo "Telegram: Settings > Data and Storage > Proxy > Add SOCKS5"
} > /root/microsocks-credentials.txt
chmod 600 /root/microsocks-credentials.txt
cat /root/microsocks-credentials.txt
