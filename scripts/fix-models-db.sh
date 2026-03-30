#!/bin/bash
set -e
cd /var/www/site-al.ru/apps/api

echo "=== ASSISTANTS: MODELS BEFORE ==="
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.assistant.findMany({ select: { id: true, name: true, model: true } })
  .then(list => {
    const counts = {};
    list.forEach(a => { counts[a.model] = (counts[a.model] || 0) + 1; });
    console.log('Model distribution:');
    Object.entries(counts).forEach(([m, n]) => console.log('  ' + m + ': ' + n));
    console.log('Total:', list.length);
    p.\$disconnect(); process.exit(0);
  }).catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null

echo ""
echo "=== VALID MODELS ON OLLAMA ==="
VALID_MODELS=$(curl -s http://188.124.55.89:11434/api/tags | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [m['name'] for m in data.get('models', []) if 'embed' not in m['name']]
print(','.join(names))
" 2>/dev/null)
echo "Valid: $VALID_MODELS"

echo ""
echo "=== UPDATING INVALID MODELS → llama3:8b ==="
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const VALID = new Set(['mistral:latest','mistral','llama3:8b','codellama:latest','mixtral:latest']);

async function main() {
  const assistants = await p.assistant.findMany({ select: { id: true, name: true, model: true } });
  let updated = 0;
  for (const a of assistants) {
    if (!VALID.has(a.model)) {
      await p.assistant.update({ where: { id: a.id }, data: { model: 'llama3:8b' } });
      console.log('  UPDATED: ' + a.name + ' | ' + a.model + ' → llama3:8b');
      updated++;
    }
  }
  console.log('Updated ' + updated + ' assistants');
  await p.\$disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null

echo ""
echo "=== ASSISTANTS: MODELS AFTER ==="
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.assistant.findMany({ select: { id: true, name: true, model: true } })
  .then(list => {
    const counts = {};
    list.forEach(a => { counts[a.model] = (counts[a.model] || 0) + 1; });
    console.log('Model distribution:');
    Object.entries(counts).forEach(([m, n]) => console.log('  ' + m + ': ' + n));
    list.forEach(a => console.log('  ' + a.model + ' | ' + a.name));
    p.\$disconnect(); process.exit(0);
  }).catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null

echo ""
echo "=== GIT PULL + DEPLOY ==="
cd /var/www/site-al.ru
git pull origin main

echo ""
echo "=== BUILD FRONTEND ==="
cd apps/web
npm run build 2>&1 | tail -5

echo ""
echo "=== PM2 RESTART ==="
cd /var/www/site-al.ru
pm2 restart ai-api --update-env
sleep 3
pm2 list | grep ai-api

echo ""
echo "=== VERIFY: modelRouter warn in logs ==="
pm2 logs ai-api --lines 20 --nostream 2>/dev/null | grep -E "MODEL|modelRouter|FALLBACK" | head -10 || echo "(no fallback logs yet — expected)"

echo ""
echo "=== DONE ==="
