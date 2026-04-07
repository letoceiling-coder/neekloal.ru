#!/bin/bash
set -a
source /etc/microsocks.env
set +a
exec /usr/bin/microsocks -i 0.0.0.0 -p 1080 -u "$MICROSOCKS_USER" -P "$MICROSOCKS_PASSWORD"
