require('dotenv').config();

const db = require('../config/database');
const logger = require('../config/logger');
const { runAllEnabledAgents } = require('../services/aiAgentOrchestratorService');

function toLimit(value, fallback = 40, max = 200) {
  const n = parseInt(String(value || ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

async function run() {
  const limit = toLimit(process.argv[2] || process.env.AI_AGENT_RUN_LIMIT || 40);
  const triggerSource = String(process.argv[3] || process.env.AI_AGENT_TRIGGER_SOURCE || 'scheduled_job').trim();
  const createdBy = String(process.argv[4] || process.env.AI_AGENT_CREATED_BY || 'system_scheduler').trim();

  const results = await runAllEnabledAgents({
    triggerSource,
    createdBy,
    limit
  });

  const summary = results.map((x) => ({
    agent: x?.agent?.code,
    run_status: x?.run?.status,
    findings: Array.isArray(x?.findings) ? x.findings.length : 0
  }));

  logger.info('AI agents run complete', { count: results.length, summary });
  await db.pool.end();
}

run().catch(async (error) => {
  logger.error('AI agents run failed', error);
  try {
    await db.pool.end();
  } catch (_error) {
    // ignore
  }
  process.exit(1);
});
