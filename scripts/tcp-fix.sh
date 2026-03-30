#!/bin/bash
set -e

echo "=== BEFORE ==="
ss -s | grep TCP

echo ""
echo "=== 1. NGINX.CONF — add keepalive ==="
NGINX_CONF="/etc/nginx/nginx.conf"
cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%s)"

# Add keepalive_timeout and keepalive_requests into http block (before closing })
# Check if already set
if grep -q "keepalive_timeout" "$NGINX_CONF"; then
  echo "keepalive_timeout already present"
else
  sed -i '/^\tgzip on;/a \\tkzip on;\n\tkeepalive_timeout 65;\n\tkeepalive_requests 1000;' "$NGINX_CONF" 2>/dev/null || true
  # Try alternative insertion point
  python3 - <<'PYEOF'
import re
with open('/etc/nginx/nginx.conf', 'r') as f:
    content = f.read()

if 'keepalive_timeout' not in content:
    # Insert before closing } of http block
    content = content.replace(
        '\tgzip on;',
        '\tgzip on;\n\tkeepalive_timeout 65;\n\tkeepalive_requests 1000;\n\tclient_header_timeout 30;\n\tclient_body_timeout 30;\n\tsend_timeout 30;'
    )
    with open('/etc/nginx/nginx.conf', 'w') as f:
        f.write(content)
    print("keepalive added to nginx.conf")
else:
    print("keepalive already present")
PYEOF
fi

echo ""
echo "=== 2. SITE-AL.RU — add proxy keep-alive ==="
SITE_CONF="/etc/nginx/sites-enabled/site-al.ru"
cp "$SITE_CONF" "${SITE_CONF}.bak.$(date +%s)"

python3 - <<'PYEOF'
with open('/etc/nginx/sites-enabled/site-al.ru', 'r') as f:
    content = f.read()

old_api = '''    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_set_header Host $host;
    }'''

new_api = '''    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 120s;
    }'''

if 'proxy_http_version 1.1' in content:
    print("proxy_http_version already set")
else:
    content = content.replace(old_api, new_api)
    with open('/etc/nginx/sites-enabled/site-al.ru', 'w') as f:
        f.write(content)
    print("proxy keep-alive added to site-al.ru")
PYEOF

echo ""
echo "=== 3. NGINX TEST ==="
nginx -t

echo ""
echo "=== 4. RELOAD NGINX ==="
systemctl reload nginx
echo "nginx reloaded"

echo ""
echo "=== 5. SYSCTL TCP TUNING ==="
# Show current values
echo "BEFORE:"
sysctl net.ipv4.tcp_fin_timeout net.ipv4.tcp_tw_reuse net.ipv4.tcp_keepalive_time

# Apply
sysctl -w net.ipv4.tcp_fin_timeout=15
sysctl -w net.ipv4.tcp_tw_reuse=1
sysctl -w net.ipv4.tcp_keepalive_time=60
sysctl -w net.ipv4.tcp_keepalive_intvl=10
sysctl -w net.ipv4.tcp_keepalive_probes=3

echo ""
echo "AFTER:"
sysctl net.ipv4.tcp_fin_timeout net.ipv4.tcp_tw_reuse net.ipv4.tcp_keepalive_time

echo ""
echo "=== 6. MAKE SYSCTL PERSISTENT ==="
SYSCTL_FILE="/etc/sysctl.d/99-ai-api-tcp.conf"
cat > "$SYSCTL_FILE" <<'EOF'
# TCP tuning for AI SaaS platform
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 3
EOF
echo "Saved to $SYSCTL_FILE"

echo ""
echo "=== 7. WAIT 5s AND CHECK SS ==="
sleep 5
ss -s | grep TCP

echo ""
echo "=== 8. VERIFY NGINX CONFIG ==="
grep -E "keepalive_timeout|keepalive_requests" /etc/nginx/nginx.conf
grep -E "proxy_http_version|proxy_set_header Connection" /etc/nginx/sites-enabled/site-al.ru
