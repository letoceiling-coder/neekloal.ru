#!/bin/bash
set -euo pipefail
for f in /etc/nginx/sites-enabled/*; do
  [[ -f "$f" ]] || continue
  grep -qE 'listen.*443' "$f" 2>/dev/null || continue
  sed -i 's/listen \[::\]:443/listen [::1]:9443/g' "$f"
  sed -i 's/listen 443 /listen 127.0.0.1:9443 /g' "$f"
done
nginx -t
systemctl reload nginx
ss -tlnp | grep -E ':443|:9443' || true
systemctl reset-failed haproxy 2>/dev/null || true
systemctl start haproxy
sleep 1
systemctl is-active haproxy nginx mtg
curl -fsS -o /dev/null -w "site_al %{http_code}\n" --connect-timeout 12 https://site-al.ru/ || true
