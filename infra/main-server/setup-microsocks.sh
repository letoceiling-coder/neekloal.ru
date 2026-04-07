#!/bin/bash
# Run once on MAIN SERVER (89.169.39.244) as root: bash setup-microsocks.sh
set -euo pipefail

if ! command -v microsocks >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y microsocks
fi

PW="$(openssl rand -base64 24 | tr -d '/+=' | head -c 22)"
{
  echo "MICROSOCKS_USER=tgproxy"
  echo "MICROSOCKS_PASSWORD=${PW}"
} > /etc/microsocks.env
chmod 600 /etc/microsocks.env

cat > /usr/local/bin/microsocks-wrap.sh << 'WRAP'
#!/bin/bash
set -a
source /etc/microsocks.env
set +a
exec /usr/bin/microsocks -i 0.0.0.0 -p 1080 -u "$MICROSOCKS_USER" -P "$MICROSOCKS_PASSWORD"
WRAP
chmod 700 /usr/local/bin/microsocks-wrap.sh

cat > /etc/systemd/system/microsocks.service << 'UNIT'
[Unit]
Description=MicroSocks SOCKS5 proxy (auth required)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/microsocks-wrap.sh
Restart=on-failure
RestartSec=4
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now microsocks

if ! ufw status | grep -qE '1080/tcp.*ALLOW'; then
  ufw allow 1080/tcp comment 'microsocks SOCKS5 tg'
fi

umask 077
{
  echo "SOCKS5 89.169.39.244:1080"
  echo "User: tgproxy"
  echo "Password: ${PW}"
  echo ""
  echo "Telegram: Settings > Data and Storage > Proxy > Add SOCKS5"
} > /root/microsocks-credentials.txt
chmod 600 /root/microsocks-credentials.txt

echo "OK microsocks active on :1080"
ss -tlnp | grep ':1080' || true
echo "--- credentials: /root/microsocks-credentials.txt ---"
cat /root/microsocks-credentials.txt
