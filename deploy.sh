#!/bin/bash
# SSOT: thin wrapper — полный сценарий в infra/site-al.ru/deploy.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "${ROOT}/infra/site-al.ru/deploy.sh"
