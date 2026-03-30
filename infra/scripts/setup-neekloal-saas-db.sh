#!/usr/bin/env bash
# Run on MAIN SERVER as root. Project: /var/www/site-al.ru
# Creates PostgreSQL role ai_user, database neekloal_saas (legacy ai_platform is left untouched).
set -eu

ROOT="/var/www/site-al.ru"
API="${ROOT}/apps/api"
PWFILE="/root/.neekloal_saas_db_password"

cd "$ROOT"
git pull origin main

if [[ ! -f "$PWFILE" ]]; then
  openssl rand -hex 32 | tr -d '\n' > "$PWFILE"
  chmod 600 "$PWFILE"
fi
PW="$(cat "$PWFILE")"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='ai_user'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER ai_user WITH PASSWORD '${PW}';"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER ai_user WITH PASSWORD '${PW}';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='neekloal_saas'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE neekloal_saas OWNER ai_user;"
fi

sudo -u postgres psql -d neekloal_saas -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO ai_user; ALTER SCHEMA public OWNER TO ai_user;"

cd "$API"
export DATABASE_URL="postgresql://ai_user:${PW}@localhost:5432/neekloal_saas?schema=public"

if [[ -f .env ]]; then
  if grep -q '^DATABASE_URL=' .env; then
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=\"${DATABASE_URL}\"|" .env
  else
    printf '\nDATABASE_URL="%s"\n' "$DATABASE_URL" >> .env
  fi
else
  printf 'DATABASE_URL="%s"\n' "$DATABASE_URL" > .env
fi

npm install --no-fund

npx prisma migrate deploy
npx prisma generate
node src/test-db.js

echo "OK: DATABASE_URL stored in apps/api/.env ; password in ${PWFILE}"
