#!/usr/bin/env bash
PGPASSWORD=e2be1c4776d8e8c00e03ae5214fccf9afc9cc549f2f272ffd192f24a5857c359
export PGPASSWORD
echo "-- memberships columns:"
psql -U ai_user -d neekloal_saas -h localhost -t -c "\d memberships" | head -15
echo "-- membership row:"
psql -U ai_user -d neekloal_saas -h localhost -t -c "SELECT * FROM memberships LIMIT 1;"
