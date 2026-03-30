#!/usr/bin/env bash
set -euo pipefail

echo "=== Install Docker ==="
apt-get update -qq
apt-get install -y -q ca-certificates curl gnupg lsb-release

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

echo "=== Docker version ==="
docker --version

echo "=== Start Qdrant ==="
mkdir -p /var/lib/qdrant
docker run -d \
  --name qdrant \
  --restart always \
  -p 6333:6333 \
  -p 6334:6334 \
  -v /var/lib/qdrant:/qdrant/storage \
  qdrant/qdrant:latest

echo "=== Wait 10s for Qdrant to start ==="
sleep 10

echo "=== Check Qdrant ==="
curl -s http://localhost:6333/collections
echo ""
curl -s http://localhost:6333/
