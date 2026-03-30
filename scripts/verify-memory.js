const { extractMemory } = require('./src/services/memoryExtractor');

let pass = 0; let fail = 0;

function test(label, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log((ok ? '✔' : '✘') + ' ' + label);
  if (!ok) console.log('   got:', JSON.stringify(got), '  want:', JSON.stringify(expected));
  ok ? pass++ : fail++;
}

// === FALLBACK: no config → all extractors run ===
const r1 = extractMemory('мой бюджет 150 000 рублей', 'pricing', null);
test('budget from text (no config)', r1.budget, 150000);

const r2 = extractMemory('хочу интернет-магазин', 'qualification_site', null);
test('projectType ecommerce (no config)', r2.projectType, 'ecommerce');

const r3 = extractMemory('нужен лендинг', 'qualification_site', null);
test('projectType landing (no config)', r3.projectType, 'landing');

const r4 = extractMemory('нужен сайт срочно', 'qualification_site', null);
test('projectType website + timeline urgent (no config)', r4.projectType === 'website' && r4.timeline === 'urgent', true);

// === CONFIG: only listed fields extracted ===
const cfgBudgetOnly = { memory: ['budget'] };
const r5 = extractMemory('бюджет 50 000 срочно нужен сайт', 'qualification_site', cfgBudgetOnly);
test('config=[budget]: only budget extracted', r5, { budget: 50000 });

const cfgTimeline = { memory: ['timeline', 'budget'] };
const r6 = extractMemory('бюджет 100к срочно', 'unknown', cfgTimeline);
test('config=[timeline,budget]: budget + timeline', r6.budget === 100 && r6.timeline === 'urgent', true);

// === timeline ===
const r7 = extractMemory('сделайте как можно скорее', 'unknown', null);
test('timeline: "как можно скорее" → urgent', r7.timeline, 'urgent');

const r8 = extractMemory('не спешите', 'unknown', null);
test('timeline: "не спешите" → flexible', r8.timeline, 'flexible');

// === phone ===
const r9 = extractMemory('позвоните +7 999 123-45-67', 'unknown', { memory: ['phone'] });
test('phone extracted', typeof r9.phone === 'string' && r9.phone.length > 6, true);

// === unknown fields in config → silently skipped ===
const r10 = extractMemory('привет', 'unknown', { memory: ['unknownField'] });
test('unknown field in config → empty result', r10, {});

// === empty message ===
const r11 = extractMemory('', 'unknown', null);
test('empty message → empty result', r11, {});

console.log('\n' + (fail === 0 ? '=== ALL ' + pass + ' TESTS PASSED ===' : `=== ${fail} FAILED / ${pass} passed ===`));
process.exit(fail > 0 ? 1 : 0);
