#!/bin/bash
# MAIN SERVER: HAProxy :443 (TCP) → nginx SSL on 127.0.0.1:9443 OR mtg on 127.0.0.1:4480 by SNI (google = MTProto).
# Telegram: MTProto, port 443, secret from /root/mtg-proxy-link.txt
set -euo pipefail

MTG_VER="v2.1.7"
MTG_PORT="4480"
NGINX_SSL_PORT="9443"
CLOAK_HOST="www.google.com"

log() { echo "[$(date -Iseconds)] $*"; }

log "backup nginx"
tar czf "/root/nginx-backup-$(date +%s).tar.gz" /etc/nginx

log "stop microsocks + UFW 8443/8444"
systemctl stop microsocks 2>/dev/null || true
systemctl disable microsocks 2>/dev/null || true
while ufw status numbered 2>/dev/null | grep -qE '8443/tcp|8444/tcp'; do
  NUM=$(ufw status numbered | grep -E '8443/tcp|8444/tcp' | tail -1 | sed -n 's/^\[\([0-9]*\)\].*/\1/p')
  [[ -n "${NUM:-}" ]] && echo yes | ufw delete "$NUM" || break
done

log "bot webhook: 127.0.0.1:8443 only"
BOT_PY="/var/www/image-to-text-bot/bot_webhook.py"
if [[ -f "$BOT_PY" ]]; then
  sed -i 's/^LISTEN_IP = "0.0.0.0"/LISTEN_IP = "127.0.0.1"/' "$BOT_PY"
  systemctl restart telegram-bot-webhook.service
fi

log "nginx: 443 -> 127.0.0.1:${NGINX_SSL_PORT} (all vhosts, including *.bak in sites-enabled)"
for f in /etc/nginx/sites-available/* /etc/nginx/sites-enabled/*; do
  [[ -f "$f" ]] || continue
  grep -qE 'listen.*443' "$f" 2>/dev/null || continue
  sed -i 's/listen \[::\]:443/listen [::1]:'"${NGINX_SSL_PORT}"'/g' "$f"
  sed -i 's/listen 443 /listen 127.0.0.1:'"${NGINX_SSL_PORT}"' /g' "$f"
done

nginx -t
systemctl restart nginx

log "install mtg ${MTG_VER}"
TMPD=$(mktemp -d)
cd "$TMPD"
curl -fsSL -o mtg.tgz "https://github.com/9seconds/mtg/releases/download/${MTG_VER}/mtg-${MTG_VER#v}-linux-amd64.tar.gz"
tar xzf mtg.tgz
install -m 755 mtg-*/mtg /usr/local/bin/mtg
cd /
rm -rf "$TMPD"

SECRET=$(/usr/local/bin/mtg generate-secret "${CLOAK_HOST}")
echo "MTG_SECRET=${SECRET}" >/etc/mtg.env
chmod 600 /etc/mtg.env

cat >/usr/local/bin/mtg-wrap.sh <<WRAP
#!/bin/bash
set -a
source /etc/mtg.env
set +a
exec /usr/local/bin/mtg simple-run "127.0.0.1:${MTG_PORT}" "\$MTG_SECRET"
WRAP
chmod 700 /usr/local/bin/mtg-wrap.sh

cat >/etc/systemd/system/mtg.service <<UNIT
[Unit]
Description=MTProto (mtg) for Telegram
After=network-online.target

[Service]
ExecStart=/usr/local/bin/mtg-wrap.sh
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

log "haproxy"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y haproxy

cat >/etc/haproxy/haproxy.cfg <<CFG
global
    log /dev/log    local0
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

defaults
    log     global
    mode    tcp
    option  dontlognull
    timeout connect 10s
    timeout client  60s
    timeout server  60s

frontend fe_https
    bind *:443
    bind :::443
    tcp-request inspect-delay 5s
    tcp-request content accept if { req_ssl_hello_type 1 }
    acl is_mtg req_ssl_sni -i ${CLOAK_HOST}
    acl is_mtg2 req_ssl_sni -i google.com
    use_backend bk_mtg if is_mtg || is_mtg2
    default_backend bk_nginx

backend bk_nginx
    mode tcp
    server nginx1 127.0.0.1:${NGINX_SSL_PORT}

backend bk_mtg
    mode tcp
    server mtg1 127.0.0.1:${MTG_PORT}
CFG

systemctl daemon-reload
systemctl enable mtg
systemctl restart mtg
sleep 1
systemctl reload nginx
sleep 1
systemctl enable haproxy
systemctl restart haproxy

log "verify"
systemctl is-active mtg haproxy nginx
ss -tlnp | grep -E ':443|:9443|:4480' || true

curl -fsS -o /dev/null -w "site_al %{http_code}\n" --connect-timeout 12 "https://site-al.ru/" || true

PUB=$(curl -fsS ifconfig.me 2>/dev/null || echo "89.169.39.244")
echo "MTProto: server=${PUB} port=443 secret=${SECRET}" >/root/mtg-proxy-link.txt
echo "tg://proxy?server=${PUB}&port=443&secret=${SECRET}" >>/root/mtg-proxy-link.txt
chmod 600 /root/mtg-proxy-link.txt
cat /root/mtg-proxy-link.txt

log "DONE"
