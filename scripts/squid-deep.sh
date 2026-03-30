#!/bin/bash
echo "=== 3PROXY PROCESS DETAIL ==="
ps -fp 1050
echo ""
echo "CMD: $(cat /proc/1050/cmdline | xargs -0 echo)"
echo "EXE: $(readlink /proc/1050/exe)"
echo "PPID: $(cat /proc/1050/status | grep PPid | awk '{print $2}')"
echo "UPTIME: started $(ps -o lstart= -p 1050)"

echo ""
echo "=== 3PROXY CONFIG ==="
cat /etc/3proxy/3proxy.cfg 2>/dev/null || echo "NO CONFIG at /etc/3proxy/3proxy.cfg"
find / -name "3proxy.cfg" 2>/dev/null | head -5

echo ""
echo "=== 3PROXY LOG ==="
find /var/log -name "*3proxy*" 2>/dev/null | head -5
ls /etc/3proxy/ 2>/dev/null

echo ""
echo "=== HOW 3PROXY STARTS (systemd/init) ==="
find /etc/systemd /etc/init.d /etc/rc.local /etc/cron* -name "*3proxy*" 2>/dev/null
systemctl status 3proxy 2>/dev/null | head -20 || echo "NO 3proxy systemd unit"

echo ""
echo "=== TOP UNIQUE CLIENT IPs (connecting to :3128) ==="
ss -tn | grep ':3128' | awk '{print $5}' | sed 's/:[0-9]*$//' | sort | uniq -c | sort -rn | head -10

echo ""
echo "=== REVERSE DNS OF TOP CLIENTS ==="
for ip in 103.161.34.10 103.161.34.44 176.65.128.158 174.138.26.218; do
  echo -n "$ip -> "
  host $ip 2>/dev/null | head -1 || echo "(no rdns)"
done

echo ""
echo "=== PM2 PROCESSES - THEIR ENV PROXY ==="
pm2 list
echo ""
for pid_dir in /proc/[0-9]*/; do
  pid=$(basename $pid_dir)
  # Only check pm2-managed node processes
  comm=$(cat $pid_dir/comm 2>/dev/null)
  if [ "$comm" = "node" ]; then
    env_proxy=$(cat $pid_dir/environ 2>/dev/null | tr '\0' '\n' | grep -i proxy | head -3)
    if [ -n "$env_proxy" ]; then
      echo "PID $pid (node): $env_proxy"
    fi
  fi
done
echo "--- done checking node pids ---"

echo ""
echo "=== NETSTAT ESTABLISHED to :3128 (first 10 unique) ==="
ss -tn state established | grep ':3128' | awk '{print $4, $5}' | head -20

echo ""
echo "=== IS 3PROXY IN rc.local or crontab? ==="
cat /etc/rc.local 2>/dev/null | grep -v "^#" | grep -v "^$" || echo "no rc.local"
crontab -l 2>/dev/null | grep 3proxy || echo "no crontab for 3proxy"
