#!/bin/bash
set -euo pipefail
source /etc/mtg.env
PUB="89.169.39.244"
echo "tg://proxy?server=${PUB}&port=443&secret=${MTG_SECRET}" >/root/mtg-proxy-link.txt
chmod 600 /root/mtg-proxy-link.txt
cat /root/mtg-proxy-link.txt
