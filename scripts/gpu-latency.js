require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const https = require('https');
const http = require('http');
const prisma = new PrismaClient();

async function timedPost(url, body, headers = {}) {
  const start = Date.now();
  return new Promise((resolve) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: 120000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - start, body: body.slice(0, 300) }));
    });
    req.on('error', e => resolve({ status: 0, ms: Date.now() - start, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ms: Date.now() - start, body: 'TIMEOUT' }); });
    req.write(data);
    req.end();
  });
}

async function main() {
  const membership = await prisma.membership.findFirst({ where: { role: 'OWNER' }, include: { user: true } });
  const assistant = await prisma.assistant.findFirst({});
  if (!membership || !assistant) { console.error('no data'); process.exit(1); }

  const token = jwt.sign({ userId: membership.user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const assistantId = assistant.id;
  await prisma.$disconnect();

  console.log('=== MODEL IN USE ===');
  console.log('Assistant model:', assistant.model);
  console.log('AssistantId:', assistantId);

  // === Direct Ollama test ===
  console.log('\n=== OLLAMA DIRECT — /api/generate (mistral:latest) ===');
  const ollamaModel = assistant.model || 'mistral:latest';
  const r0 = await timedPost('http://188.124.55.89:11434/api/generate', {
    model: ollamaModel, prompt: 'Скажи "Привет" одним словом.', stream: false
  });
  console.log(`Status: ${r0.status}  Time: ${r0.ms}ms`);
  try {
    const d = JSON.parse(r0.body);
    console.log('Response:', d.response);
    if (d.eval_count && d.eval_duration) {
      console.log(`Speed: ${(d.eval_count / (d.eval_duration / 1e9)).toFixed(1)} tok/s (${d.eval_count} tokens)`);
    }
    if (d.load_duration) console.log(`Model load time: ${(d.load_duration / 1e9).toFixed(2)}s`);
    if (d.total_duration) console.log(`Total duration: ${(d.total_duration / 1e9).toFixed(2)}s`);
  } catch(e) { console.log('Raw:', r0.body); }

  // === Check running models after load ===
  console.log('\n=== OLLAMA /api/ps (after load) ===');
  const psRes = await new Promise((resolve) => {
    http.get('http://188.124.55.89:11434/api/ps', { timeout: 5000 }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b));
    }).on('error', e => resolve(e.message));
  });
  try {
    const ps = JSON.parse(psRes);
    const models = ps.models || [];
    if (models.length === 0) {
      console.log('No models currently loaded in VRAM');
    } else {
      models.forEach(m => {
        console.log(`Loaded: ${m.name}  VRAM: ${(m.size_vram / 1024 / 1024 / 1024).toFixed(2)} GB  expires: ${m.expires_at}`);
      });
    }
  } catch(e) { console.log('PS:', psRes.slice(0, 200)); }

  // === Chat endpoint latency ===
  console.log('\n=== CHAT ENDPOINT LATENCY (3 requests) ===');
  for (let i = 1; i <= 3; i++) {
    const r = await timedPost('http://localhost:4000/chat', {
      assistantId, message: `Тест производительности ${i}. Ответь одним предложением.`
    }, { Authorization: `Bearer ${token}` });
    let reply = '(error)';
    try { reply = JSON.parse(r.body).reply?.slice(0, 80) || r.body.slice(0, 80); } catch(e) {}
    console.log(`Request ${i} → HTTP ${r.status}  ${r.ms}ms`);
    if (r.status === 200) console.log(`  Reply: ${reply}`);
    else console.log(`  Body: ${r.body.slice(0, 100)}`);
  }

  // === Embedding latency ===
  console.log('\n=== EMBEDDING LATENCY (3 requests) ===');
  for (let i = 1; i <= 3; i++) {
    const r = await timedPost('http://188.124.55.89:11434/api/embeddings', {
      model: 'nomic-embed-text', prompt: 'Тест производительности векторного поиска'
    });
    const dims = (() => { try { return JSON.parse(r.body).embedding?.length; } catch(e) { return 0; } })();
    console.log(`Embed ${i} → HTTP ${r.status}  ${r.ms}ms  dims: ${dims}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
