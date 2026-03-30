#!/bin/bash
set -e
cd /var/www/site-al.ru

echo "=== GIT PULL ==="
git pull origin main

echo ""
echo "=== APPLY MIGRATION ==="
cd apps/api
# Apply the SQL migration manually (since we don't use prisma migrate dev in prod)
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$executeRawUnsafe('ALTER TABLE assistants ADD COLUMN IF NOT EXISTS config JSONB')
  .then(() => { console.log('Migration applied: config column added'); return p.\$disconnect(); })
  .then(() => process.exit(0))
  .catch(e => { console.error('Migration error:', e.message); process.exit(1); });
" 2>/dev/null

echo ""
echo "=== REGENERATE PRISMA CLIENT ==="
npx prisma generate 2>&1 | tail -5

echo ""
echo "=== PM2 RESTART ==="
cd /var/www/site-al.ru
pm2 restart ai-api --update-env
sleep 4
pm2 list | grep ai-api

echo ""
echo "=== VERIFY: column exists in DB ==="
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.assistant.findFirst({ select: { id: true, name: true, config: true } })
  .then(a => {
    if (!a) { console.log('No assistants found'); return p.\$disconnect(); }
    console.log('OK — assistant.config accessible:', a.config === null ? 'null (no config set)' : JSON.stringify(a.config));
    return p.\$disconnect();
  })
  .then(() => process.exit(0))
  .catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null

echo ""
echo "=== VERIFY: configLoader loads default ==="
node -e "
const { getAssistantConfig } = require('/var/www/site-al.ru/apps/api/src/services/configLoader');

// Test 1: assistant with no config → default
const cfg1 = getAssistantConfig({ config: null });
console.log('Test 1 (no config → default):', JSON.stringify(cfg1.intents).slice(0, 60) + '...');

// Test 2: assistant with partial config override
const cfg2 = getAssistantConfig({ config: { intents: { support: ['помощь', 'проблема'] } } });
console.log('Test 2 (custom intents):', JSON.stringify(cfg2.intents));
console.log('Test 2 funnel still default:', JSON.stringify(cfg2.funnel));
" 2>/dev/null

echo ""
echo "=== VERIFY: detectIntent with config ==="
node -e "
const { detectIntent } = require('/var/www/site-al.ru/apps/api/src/services/intentDetector');

// Test 1: no config → built-in
const r1 = detectIntent('сколько стоит сайт', null);
console.log('No config - pricing keyword:', JSON.stringify(r1));

// Test 2: custom config
const customConfig = { intents: { support: ['помощь', 'проблема'], sales: ['купить', 'заказать'] } };
const r2 = detectIntent('хочу купить', customConfig);
console.log('Custom config - sales keyword:', JSON.stringify(r2));

// Test 3: fallback for unknown
const r3 = detectIntent('привет', null);
console.log('Unknown intent fallback:', JSON.stringify(r3));
" 2>/dev/null

echo ""
echo "=== VERIFY: no errors in pm2 logs ==="
pm2 logs ai-api --lines 20 --nostream 2>/dev/null | grep -E "ERROR|configLoader|CONFIG USED" | head -10 || echo "(no config log yet — triggered on first chat request)"

echo ""
echo "=== TEST: set config on one assistant ==="
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const customConfig = {
  intents: {
    support: ['помощь', 'поддержка', 'проблема'],
    pricing: ['цена', 'стоимость', 'сколько'],
  },
  funnel: ['greeting', 'qualification', 'close'],
  validation: { maxSentences: 2, questions: 1 },
};

p.assistant.findFirst({ select: { id: true, name: true } })
  .then(a => {
    if (!a) { console.log('no assistant'); return p.\$disconnect(); }
    return p.assistant.update({ where: { id: a.id }, data: { config: customConfig } })
      .then(updated => {
        console.log('Config set on assistant:', updated.name);
        console.log('Config:', JSON.stringify(updated.config).slice(0, 100));
        return p.\$disconnect();
      });
  })
  .then(() => process.exit(0))
  .catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null

echo ""
echo "=== DONE ==="
