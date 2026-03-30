#!/bin/bash
sed -i '/^\tkzip on;$/d' /etc/nginx/nginx.conf
echo "=== nginx.conf fixed ==="
grep -n "gzip\|kzip\|keepalive" /etc/nginx/nginx.conf
nginx -t && systemctl reload nginx && echo "nginx reloaded OK"
