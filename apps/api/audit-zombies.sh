#!/bin/bash
# READ-ONLY zombie root cause analysis

SEP="============================================================"

echo "$SEP"
echo "STEP 1 — ZOMBIES WITH PPID"
echo "$SEP"
ps -eo pid,ppid,user,stat,cmd | grep defunct

echo "$SEP"
echo "STEP 2 — TOP PARENT PIDs BY CHILD COUNT"
echo "$SEP"
ps -eo ppid | sort | uniq -c | sort -nr | head -20

echo "$SEP"
echo "STEP 3 — FIND THE TOP ZOMBIE PARENTS"
echo "$SEP"
# Get unique PPIDs of all defunct processes
PPIDS=$(ps -eo pid,ppid,stat | awk '$3~/Z/{print $2}' | sort -u)
echo "Unique PPIDs of zombie children:"
echo "$PPIDS"
for ppid in $PPIDS; do
  echo "--- PPID=$ppid ---"
  ps -fp $ppid 2>/dev/null || echo "PID $ppid: NOT FOUND (parent already dead)"
done

echo "$SEP"
echo "STEP 3b — GRANDPARENT CHAIN"
echo "$SEP"
for ppid in $PPIDS; do
  echo "--- Process tree for PPID=$ppid ---"
  pstree -p $ppid 2>/dev/null || ps --ppid $ppid 2>/dev/null || echo "no children found"
  # Get grandparent
  gp=$(ps -o ppid= -p $ppid 2>/dev/null | tr -d ' ')
  if [ -n "$gp" ]; then
    echo "  grandparent PPID=$gp:"
    ps -fp $gp 2>/dev/null || echo "  grandparent $gp not found"
  fi
done

echo "$SEP"
echo "STEP 4 — CRON JOBS"
echo "$SEP"
echo "--- root crontab ---"
crontab -l 2>/dev/null || echo "no root crontab"
echo "--- www-data crontab ---"
crontab -u www-data -l 2>/dev/null || echo "no www-data crontab"
echo "--- /etc/crontab ---"
cat /etc/crontab 2>/dev/null
echo "--- /etc/cron.d/ ---"
ls -la /etc/cron.d/ 2>/dev/null
for f in /etc/cron.d/*; do echo "=== $f ==="; cat "$f" 2>/dev/null; done
echo "--- /etc/cron.* dirs ---"
ls -la /etc/cron.hourly/ /etc/cron.daily/ /etc/cron.weekly/ 2>/dev/null
echo "--- crontabs spool ---"
ls -la /var/spool/cron/crontabs/ 2>/dev/null || echo "empty or no crontabs dir"
echo "--- grep */5 in cron ---"
grep -r "\*/5" /etc/cron* 2>/dev/null || echo "no */5 jobs"

echo "$SEP"
echo "STEP 5 — PHP PROCESSES"
echo "$SEP"
ps aux | grep -i php | grep -v grep

echo "$SEP"
echo "STEP 6 — NODE PROCESSES"
echo "$SEP"
ps aux | grep node | grep -v grep

echo "$SEP"
echo "STEP 7 — NGINX WORKER CHILDREN"
echo "$SEP"
ps -eo pid,ppid,user,cmd | grep nginx | grep -v grep

echo "$SEP"
echo "STEP 8 — WHAT IS RUNNING AS www-data"
echo "$SEP"
ps aux --user www-data | grep -v grep

echo "$SEP"
echo "STEP 9 — LAST ZOMBIE TIMING (interval analysis)"
echo "$SEP"
echo "First zombie PID: $(ps -eo pid,ppid,stat | awk '$3~/Z/{print $1}' | sort -n | head -1)"
echo "Last zombie PID:  $(ps -eo pid,ppid,stat | awk '$3~/Z/{print $1}' | sort -n | tail -1)"
echo "Total zombies:    $(ps -eo stat | grep -c Z)"
echo "Time span from ps (start times):"
ps -eo pid,ppid,user,stat,lstart | awk '$4~/Z/{print}' | head -20

echo "$SEP"
echo "STEP 10 — SUPERVISORD / SYSTEMD SERVICE CHECK"
echo "$SEP"
echo "--- supervisord services with www-data ---"
grep -r "www-data" /etc/supervisor* 2>/dev/null || echo "not found"
echo "--- systemd units running as www-data ---"
systemctl list-units --state=running 2>/dev/null | grep -i "php\|fpm\|apache\|nginx" | head -20
echo "--- active nginx/php unit status ---"
systemctl is-active php8.3-fpm 2>/dev/null || systemctl is-active php-fpm 2>/dev/null || echo "php-fpm status unknown"
echo "--- nginx FastCGI config (check for www-data exec) ---"
grep -r "fastcgi_pass\|php_value\|exec\|passthru\|system\|shell_exec" /etc/nginx/sites-enabled/ 2>/dev/null | head -20

echo "$SEP"
echo "ZOMBIE AUDIT COMPLETE — $(date)"
echo "$SEP"
