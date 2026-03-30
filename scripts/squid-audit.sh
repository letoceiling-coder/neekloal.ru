#!/bin/bash
echo "=== 1. SQUID PROCESS ==="
ps aux | grep -i squid | grep -v grep || echo "NO squid process found"

echo ""
echo "=== 2. SYSTEMD SERVICE ==="
systemctl status squid 2>/dev/null || systemctl status squid.service 2>/dev/null || echo "NO squid service"

echo ""
echo "=== 3. PORT 3128 LISTENERS ==="
ss -tnlp | grep 3128 || echo "NOTHING listening on 3128"

echo ""
echo "=== 4. PORT 3128 ALL CONNECTIONS ==="
ss -tnp | grep 3128 | head -30

echo ""
echo "=== 5. LSOF :3128 ==="
lsof -i :3128 2>/dev/null | head -40 || echo "lsof returned nothing"

echo ""
echo "=== 6. COUNT TIME_WAIT ON 3128 ==="
ss -tn state time-wait | grep ':3128' | wc -l

echo ""
echo "=== 7. UNIQUE REMOTE IPs connecting to 3128 ==="
ss -tn | grep ':3128' | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -20

echo ""
echo "=== 8. ENV PROXY VARS ==="
printenv | grep -i proxy || echo "NO proxy env vars"

echo ""
echo "=== 9. GREP CODE FOR 3128 ==="
grep -r "3128" /var/www/ --include="*.js" --include="*.php" --include="*.py" --include="*.env" --include="*.conf" --include="*.sh" -l 2>/dev/null | head -20 || echo "NO code references to 3128"

echo ""
echo "=== 10. GREP HTTP_PROXY IN CODE ==="
grep -r "HTTP_PROXY\|http_proxy\|HTTPS_PROXY\|https_proxy" /var/www/ --include="*.js" --include="*.php" --include="*.py" --include="*.env" -l 2>/dev/null | head -20 || echo "NO proxy env in code"

echo ""
echo "=== 11. SQUID CONFIG ==="
cat /etc/squid/squid.conf 2>/dev/null | grep -v "^#" | grep -v "^$" | head -50 || echo "NO squid.conf or empty"

echo ""
echo "=== 12. SQUID ACCESS LOG (last 30 lines) ==="
tail -n 30 /var/log/squid/access.log 2>/dev/null || echo "NO access log"

echo ""
echo "=== 13. SQUID CACHE LOG ==="
tail -n 10 /var/log/squid/cache.log 2>/dev/null || echo "NO cache log"

echo ""
echo "=== 14. PM2 LIST ==="
pm2 list

echo ""
echo "=== 15. ESTABLISHED CONNECTIONS DETAIL on 3128 ==="
ss -tnp state established | grep '3128' | head -20 || echo "NO established on 3128"

echo ""
echo "=== 16. SQUID ALLOWED HOSTS IN CONFIG ==="
grep -E "acl|http_access|cache_peer|http_port" /etc/squid/squid.conf 2>/dev/null | grep -v "^#" | head -30 || echo "no squid config"
