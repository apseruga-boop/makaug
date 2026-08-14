const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function withServer(handler, run) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.end(error.message);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  const previousEnv = { ...process.env };
  process.env.WHATSAPP_AI_RUNTIME_TOKEN = 'test-runtime-token';
  delete process.env.OPENAI_API_KEY;

  const runtimePath = require.resolve('../scripts/whatsapp-ai-runtime');
  delete require.cache[runtimePath];
  const runtime = require(runtimePath);

  await withServer(runtime.handler, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.strictEqual(health.status, 200, 'runtime liveness must not depend on OpenAI or worker readiness');
    const healthPayload = await health.json();
    assert.strictEqual(healthPayload.country_code, 'UG', 'runtime must be Uganda-only');
    assert.strictEqual(healthPayload.marker, runtime.RELEASE_MARKER, 'runtime must expose its audited marker');

    const unauthorized = await fetch(`${baseUrl}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'worker', status: 'online' })
    });
    assert.strictEqual(unauthorized.status, 401, 'worker heartbeat must require the isolated runtime token');

    const accepted = await fetch(`${baseUrl}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-runtime-token'
      },
      body: JSON.stringify({ client_id: 'worker', status: 'online', reported_at: new Date().toISOString() })
    });
    assert.strictEqual(accepted.status, 200, 'authorized worker heartbeat must be recorded');

    const ready = await fetch(`${baseUrl}/ready`);
    assert.strictEqual(ready.status, 503, 'readiness must fail closed when the dedicated OpenAI key is absent');
    const readyPayload = await ready.json();
    assert.strictEqual(readyPayload.worker.fresh, true, 'readiness must include fresh worker heartbeat state');
    assert.strictEqual(readyPayload.openai_configured, false, 'readiness must not pretend the AI project is configured');
  });

  process.env = previousEnv;

  const provider = require('../services/llmProvider');
  const providerEnv = { ...process.env };
  process.env.LLM_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'generic-site-key';
  process.env.WHATSAPP_LLM_PROVIDER = 'openai_compat';
  process.env.WHATSAPP_LLM_API_BASE_URL = 'https://runtime.example/v1';
  process.env.WHATSAPP_LLM_API_KEY = 'runtime-auth-token';
  process.env.LLM_REPLY_MODEL = 'generic-site-model';
  process.env.WHATSAPP_LLM_REPLY_MODEL = 'whatsapp-project-model';

  let config = provider.resolveProviderConfig('whatsapp');
  assert.strictEqual(config.provider, 'openai_compat', 'WhatsApp must use its explicitly scoped provider');
  assert.strictEqual(config.baseURL, 'https://runtime.example/v1', 'WhatsApp must call the isolated runtime');
  assert.strictEqual(config.apiKey, 'runtime-auth-token', 'the main app must hold only the runtime auth token');
  assert.strictEqual(provider.getTaskModel('reply', 'safe-fallback', 'whatsapp'), 'whatsapp-project-model', 'WhatsApp must prefer its own scoped model configuration');

  delete process.env.WHATSAPP_LLM_API_KEY;
  config = provider.resolveProviderConfig('whatsapp');
  assert.strictEqual(config.hasKey, false, 'a configured WhatsApp scope must fail closed instead of borrowing the generic site key');
  assert.strictEqual(config.apiKey, '', 'generic OpenAI credentials must not cross into the WhatsApp scope');
  process.env = providerEnv;

  const renderYaml = read('render.yaml');
  const workerSource = read('scripts/whatsapp-web-copilot.js');
  const serverSource = read('server.js');
  const routeSource = read('routes/whatsapp.js');
  const uptimeWorkflow = read('.github/workflows/makaug-whatsapp-uptime.yml');

  assert(renderYaml.includes('name: makaug-whatsapp-ai-runtime') && renderYaml.includes('plan: starter'), 'blueprint must declare the paid always-on Uganda AI runtime');
  assert(renderYaml.includes('OPENAI_PROJECT') && renderYaml.includes('OPENAI_API_KEY') && renderYaml.includes('sync: false'), 'dedicated project/key must remain private Render configuration');
  assert(workerSource.includes('WHATSAPP_WEB_COPILOT_MAX_SESSION_MS') && workerSource.includes('planned browser recycle'), 'worker must recycle Chromium before memory grows without bound');
  assert(workerSource.includes('OUTBOX_POLL_MS') && !workerSource.includes('const sentAtLoopEnd = await processOutbox'), 'outbox polling must not busy-loop twice per scan');
  assert(serverSource.includes('PUBLIC_HTML_CACHE_MAX_ENTRIES') && serverSource.includes('while (publicHtmlCache.size > PUBLIC_HTML_CACHE_MAX_ENTRIES)'), 'large rendered HTML cache must be bounded');
  assert(serverSource.includes("...(!IS_SOUTH_AFRICA ? ['makaug-always-on-whatsapp-runtime-20260814'] : [])"), 'release marker must remain Uganda-only');
  assert(routeSource.includes("const WHATSAPP_PROVIDER_SCOPE = 'whatsapp'") && routeSource.includes('providerScope: WHATSAPP_PROVIDER_SCOPE'), 'all WhatsApp AI calls must opt into the isolated provider scope');
  assert(uptimeWorkflow.includes('cron: "*/5 * * * *"') && uptimeWorkflow.includes('makaug-whatsapp-ai-runtime.onrender.com/ready'), 'an external five-minute monitor must verify both AI runtime and transport-worker readiness');

  const seo = require('../services/publicSeoService');
  seo.__seoSnapshotCache.clear();
  let now = Date.now();
  const realNow = Date.now;
  let resolveRefresh;
  let queryCount = 0;
  const db = {
    query: async () => {
      queryCount += 1;
      if (queryCount === 1) return { rows: [] };
      return new Promise((resolve) => { resolveRefresh = resolve; });
    }
  };
  Date.now = () => now;
  try {
    const first = await seo.loadPublicSeoInventorySnapshot(db);
    now += seo.PUBLIC_SEO_CACHE_TTL_MS + 1;
    const stale = await seo.loadPublicSeoInventorySnapshot(db);
    assert.strictEqual(stale, first, 'expired SEO cache must serve last-known-good data immediately');
    assert.strictEqual(queryCount, 2, 'stale access must start one background refresh');
    resolveRefresh({ rows: [] });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    Date.now = realNow;
    seo.__seoSnapshotCache.clear();
  }

  console.log('WhatsApp isolated always-on runtime and cold-path safeguards ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
