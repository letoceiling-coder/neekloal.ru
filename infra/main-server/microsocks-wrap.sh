#!/bin/bash
set -a
source /etc/microsocks.env
set +a
# Port: 8444 (1080 closed in UFW; 8443 is used by telegram-bot-webhook on this host)
exec /usr/bin/microsocks -i 0.0.0.0 -p 8444 -u "$MICROSOCKS_USER" -P "$MICROSOCKS_PASSWORD"
