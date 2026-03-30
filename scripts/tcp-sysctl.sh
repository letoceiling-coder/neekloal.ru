#!/bin/bash
echo "=== SYSCTL BEFORE ==="
sysctl net.ipv4.tcp_fin_timeout net.ipv4.tcp_tw_reuse

echo ""
echo "=== APPLY SYSCTL ==="
sysctl -w net.ipv4.tcp_fin_timeout=15
sysctl -w net.ipv4.tcp_tw_reuse=1
sysctl -w net.ipv4.tcp_keepalive_time=60
sysctl -w net.ipv4.tcp_keepalive_intvl=10
sysctl -w net.ipv4.tcp_keepalive_probes=3

echo ""
echo "=== PERSIST TO /etc/sysctl.d/99-ai-api-tcp.conf ==="
cat > /etc/sysctl.d/99-ai-api-tcp.conf <<'EOF'
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 3
EOF
echo "saved"

echo ""
echo "=== RESTART AI-API ==="
pm2 restart ai-api --update-env
sleep 3
pm2 list | grep ai-api

echo ""
echo "=== WAIT 10s FOR CONNECTIONS TO DRAIN ==="
sleep 10

echo ""
echo "=== SS AFTER ==="
ss -s

echo ""
echo "=== VERIFY NGINX PROXY SETTINGS ==="
grep -A 8 "location /api/" /etc/nginx/sites-enabled/site-al.ru
