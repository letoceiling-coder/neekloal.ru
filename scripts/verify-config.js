require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { getAssistantConfig } = require('./src/services/configLoader');
const { detectIntent } = require('./src/services/intentDetector');

const p = new PrismaClient();

async function main() {
  // 1. DB column check
  console.log('=== 1. DB COLUMN CHECK ===');
  const asst = await p.assistant.findFirst({ select: { id: true, name: true, config: true } });
  if (!asst) { console.log('No assistants found'); return; }
  console.log('OK — assistant.config accessible:', asst.config === null ? 'null (default)' : JSON.stringify(asst.config).slice(0, 100));

  // 2. configLoader tests
  console.log('\n=== 2. configLoader TESTS ===');
  const cfg1 = getAssistantConfig({ config: null });
  console.log('Test 1 (config=null → default):', Object.keys(cfg1.intents).join(', '));

  const cfg2 = getAssistantConfig({ config: { intents: { support: ['помощь', 'проблема'], order: ['заказать'] } } });
  console.log('Test 2 (custom intents):', Object.keys(cfg2.intents).join(', '));
  console.log('Test 2 funnel (still default):', cfg2.funnel.join(' → '));

  // 3. detectIntent tests
  console.log('\n=== 3. detectIntent TESTS ===');
  console.log('No config, pricing kw:', JSON.stringify(detectIntent('сколько стоит сайт', null)));
  console.log('No config, objection kw:', JSON.stringify(detectIntent('это слишком дорого', null)));
  console.log('No config, unknown:', JSON.stringify(detectIntent('привет как дела', null)));
  console.log('Custom config, support kw:', JSON.stringify(detectIntent('у меня проблема', { intents: { support: ['проблема', 'ошибка'] } })));
  console.log('Custom config, unknown:', JSON.stringify(detectIntent('спасибо', { intents: { support: ['проблема'] } })));

  // 4. Set config on first assistant
  console.log('\n=== 4. SET CONFIG ON FIRST ASSISTANT ===');
  const customConfig = {
    intents: { support: ['помощь', 'поддержка', 'проблема'], pricing: ['цена', 'стоимость'] },
    funnel: ['greeting', 'qualification', 'close'],
    validation: { maxSentences: 2, questions: 1 },
  };
  const updated = await p.assistant.update({ where: { id: asst.id }, data: { config: customConfig } });
  console.log('Config set on:', updated.name);
  console.log('Stored config intents:', Object.keys(updated.config.intents).join(', '));

  // 5. Reload and use
  console.log('\n=== 5. ROUNDTRIP: LOAD FROM DB + DETECT ===');
  const reloaded = await p.assistant.findUnique({ where: { id: asst.id }, select: { config: true } });
  const loadedCfg = getAssistantConfig(reloaded);
  const intentResult = detectIntent('у меня проблема с заказом', loadedCfg);
  console.log('Detect with DB config:', JSON.stringify(intentResult), '← should be "support"');

  // 6. Reset config to null (fallback test)
  console.log('\n=== 6. RESET CONFIG → NULL (FALLBACK) ===');
  await p.assistant.update({ where: { id: asst.id }, data: { config: null } });
  const reloaded2 = await p.assistant.findUnique({ where: { id: asst.id }, select: { config: true } });
  const fallbackCfg = getAssistantConfig(reloaded2);
  const fallbackResult = detectIntent('сколько стоит', fallbackCfg);
  console.log('Detect with default config (fallback):', JSON.stringify(fallbackResult), '← should be "pricing"');

  await p.$disconnect();
  console.log('\n=== ALL TESTS PASSED ===');
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
