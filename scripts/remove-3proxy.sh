#!/bin/bash
echo "=== BEFORE: PORT 3128 ==="
ss -tulnp | grep 3128

echo ""
echo "=== BEFORE: TCP STATE ==="
ss -s | grep TCP

echo ""
echo "=== BEFORE: 3PROXY PROCESS ==="
ps aux | grep 3proxy | grep -v grep

echo ""
echo "=== STEP 1: STOP 3PROXY ==="
systemctl stop 3proxy
echo "stop: exit code $?"

echo ""
echo "=== STEP 2: DISABLE AUTOSTART ==="
systemctl disable 3proxy
echo "disable: exit code $?"

echo ""
echo "=== STEP 3: WAIT 3s FOR CONNECTIONS TO CLOSE ==="
sleep 3

echo ""
echo "=== STEP 4: VERIFY PORT 3128 IS FREE ==="
result=$(ss -tulnp | grep 3128)
if [ -z "$result" ]; then
  echo "OK — port 3128 is FREE"
else
  echo "WARNING — port 3128 still occupied:"
  echo "$result"
fi

echo ""
echo "=== STEP 5: VERIFY NO PROCESS ==="
proc=$(ps aux | grep 3proxy | grep -v grep)
if [ -z "$proc" ]; then
  echo "OK — no 3proxy process running"
else
  echo "WARNING — process still alive:"
  echo "$proc"
fi

echo ""
echo "=== STEP 6: TCP STATE AFTER STOP ==="
ss -s | grep TCP

echo ""
echo "=== STEP 7: REMOVE BINARIES AND CONFIG ==="
rm -f /usr/local/bin/3proxy
echo "removed /usr/local/bin/3proxy: $?"

rm -rf /etc/3proxy
echo "removed /etc/3proxy/: $?"

# Log is 7.8 GB — remove it
rm -f /var/log/3proxy.log
echo "removed /var/log/3proxy.log (7.8 GB): $?"

# Remove optional secondary config location found in audit
rm -rf /opt/3proxy-src
echo "removed /opt/3proxy-src/: $?"

echo ""
echo "=== STEP 8: REMOVE SYSTEMD UNIT ==="
rm -f /etc/systemd/system/3proxy.service
rm -f /etc/systemd/system/multi-user.target.wants/3proxy.service
systemctl daemon-reload
echo "systemd unit removed and daemon reloaded"

echo ""
echo "=== STEP 9: FINAL VERIFICATION ==="
echo "--- port 3128 ---"
ss -tulnp | grep 3128 || echo "OK — port 3128 not found"

echo ""
echo "--- process ---"
ps aux | grep 3proxy | grep -v grep || echo "OK — no 3proxy process"

echo ""
echo "--- binary ---"
ls -la /usr/local/bin/3proxy 2>/dev/null || echo "OK — binary removed"

echo ""
echo "--- config ---"
ls -la /etc/3proxy/ 2>/dev/null || echo "OK — config dir removed"

echo ""
echo "--- log ---"
ls -lh /var/log/3proxy.log 2>/dev/null || echo "OK — log removed (7.8 GB freed)"

echo ""
echo "--- systemd ---"
systemctl status 3proxy 2>&1 | head -5

echo ""
echo "=== STEP 10: TCP STATE FINAL ==="
sleep 10
ss -s | grep TCP
echo ""
echo "TIME_WAIT on 3128 (should be 0 or dropping):"
ss -tn state time-wait | grep ':3128' | wc -l

echo ""
echo "=== DISK SPACE FREED ==="
df -h /var/log | tail -1

echo ""
echo "=== DONE ==="
