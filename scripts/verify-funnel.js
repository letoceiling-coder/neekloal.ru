const { computeNextStage, getNextStage, VALID_STAGES } = require('./src/services/hybridSales');
const defaultConfig = require('./src/config/defaultAssistantConfig');

let pass = 0; let fail = 0;
function test(label, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log((ok ? '✔' : '✘') + ' ' + label);
  if (!ok) console.log('   got:', JSON.stringify(got), '  want:', JSON.stringify(expected));
  ok ? pass++ : fail++;
}

const DEFAULT_FUNNEL = defaultConfig.funnel;

// ── computeNextStage (original, untouched) ──────────────────────────────────
test('computeNextStage: qualification_site → qualification',
  computeNextStage('greeting', 'qualification_site'), 'qualification');
test('computeNextStage: pricing → offer',
  computeNextStage('qualification', 'pricing'), 'offer');
test('computeNextStage: objection → objection',
  computeNextStage('offer', 'objection'), 'objection');
test('computeNextStage: close → close',
  computeNextStage('objection', 'close'), 'close');
test('computeNextStage: unknown intent keeps current stage',
  computeNextStage('offer', 'unknown'), 'offer');

// ── getNextStage: no config → falls back to computeNextStage ────────────────
test('getNextStage: no config → computeNextStage fallback (pricing → offer)',
  getNextStage('qualification', 'pricing', null), 'offer');
test('getNextStage: no config → computeNextStage fallback (unknown → keep)',
  getNextStage('offer', 'unknown', null), 'offer');

// ── getNextStage: with config.funnel → sequential ───────────────────────────
test('getNextStage: greeting → qualification (sequential)',
  getNextStage('greeting', 'unknown', { funnel: DEFAULT_FUNNEL }), 'qualification');
test('getNextStage: qualification → offer (sequential)',
  getNextStage('qualification', 'unknown', { funnel: DEFAULT_FUNNEL }), 'offer');
test('getNextStage: offer → objection (sequential)',
  getNextStage('offer', 'unknown', { funnel: DEFAULT_FUNNEL }), 'objection');
test('getNextStage: objection → close (sequential)',
  getNextStage('objection', 'unknown', { funnel: DEFAULT_FUNNEL }), 'close');
test('getNextStage: close → close (end of funnel, stay)',
  getNextStage('close', 'unknown', { funnel: DEFAULT_FUNNEL }), 'close');
test('getNextStage: unknown stage → first stage',
  getNextStage('nonexistent', 'unknown', { funnel: DEFAULT_FUNNEL }), 'greeting');

// ── Custom funnel ────────────────────────────────────────────────────────────
const customFunnel = { funnel: ['intro', 'demo', 'proposal', 'closed'] };
test('custom funnel: intro → demo',
  getNextStage('intro', 'unknown', customFunnel), 'demo');
test('custom funnel: demo → proposal',
  getNextStage('demo', 'unknown', customFunnel), 'proposal');
test('custom funnel: proposal → closed',
  getNextStage('proposal', 'unknown', customFunnel), 'closed');
test('custom funnel: closed → closed (end)',
  getNextStage('closed', 'unknown', customFunnel), 'closed');
test('custom funnel: unknown stage → first stage',
  getNextStage('greeting', 'unknown', customFunnel), 'intro');

// ── defaultConfig has stageIntents ──────────────────────────────────────────
test('defaultConfig.stageIntents exists', typeof defaultConfig.stageIntents, 'object');
test('stageIntents.objection = objection',
  defaultConfig.stageIntents.objection, 'objection');
test('stageIntents.offer = pricing',
  defaultConfig.stageIntents.offer, 'pricing');
test('stageIntents.qualification = qualification_site',
  defaultConfig.stageIntents.qualification, 'qualification_site');

// ── VALID_STAGES still exported ───────────────────────────────────────────────
test('VALID_STAGES exported and has greeting',
  VALID_STAGES.has('greeting'), true);

console.log('\n' + (fail === 0
  ? `=== ALL ${pass} TESTS PASSED ===`
  : `=== ${fail} FAILED / ${pass} passed ===`));
process.exit(fail > 0 ? 1 : 0);
