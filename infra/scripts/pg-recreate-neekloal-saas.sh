#!/usr/bin/env bash
set -eu
sudo -u postgres psql -c "DROP DATABASE IF EXISTS neekloal_saas;"
sudo -u postgres psql -c "CREATE DATABASE neekloal_saas OWNER ai_user;"
sudo -u postgres psql -d neekloal_saas -c "GRANT ALL ON SCHEMA public TO ai_user; ALTER SCHEMA public OWNER TO ai_user;"
