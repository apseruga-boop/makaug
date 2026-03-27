const express = require('express');

const { requireAdminApiKey, requireSuperAdminKey } = require('../middleware/auth');
const {
  listAgents,
  updateAgent,
  runAgent,
  runAllEnabledAgents,
  listRuns,
  listFindings,
  decideFinding,
  listActions,
  approveAction,
  executeAction
} = require('../services/aiAgentOrchestratorService');

const router = express.Router();

router.use(requireAdminApiKey);

function toLimit(value, fallback = 50, max = 500) {
  const n = parseInt(String(value || ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

router.get('/agents', async (req, res, next) => {
  try {
    const data = await listAgents();
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.patch('/agents/:id', async (req, res, next) => {
  try {
    const updated = await updateAgent(req.params.id, {
      enabled: req.body.enabled,
      run_mode: req.body.run_mode,
      config: req.body.config
    });
    if (!updated) return res.status(404).json({ ok: false, error: 'AI agent not found' });
    return res.json({ ok: true, data: updated });
  } catch (error) {
    return next(error);
  }
});

router.post('/run', async (req, res, next) => {
  try {
    const agentCode = String(req.body.agent_code || '').trim();
    const triggerSource = String(req.body.trigger_source || 'manual_admin').trim();
    const createdBy = String(req.body.created_by || 'admin_api_key').trim();
    const limit = toLimit(req.body.limit, 40, 200);

    if (!agentCode || agentCode === 'all') {
      const data = await runAllEnabledAgents({
        triggerSource,
        createdBy,
        limit
      });
      return res.json({ ok: true, data });
    }

    const data = await runAgent({
      agentCode,
      triggerSource,
      createdBy,
      limit
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/runs', async (req, res, next) => {
  try {
    const data = await listRuns({ limit: toLimit(req.query.limit, 100, 500) });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/findings', async (req, res, next) => {
  try {
    const data = await listFindings({
      status: String(req.query.status || '').trim().toLowerCase(),
      severity: String(req.query.severity || '').trim().toLowerCase(),
      agentCode: String(req.query.agent_code || '').trim(),
      limit: toLimit(req.query.limit, 100, 500)
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/findings/:id/decision', async (req, res, next) => {
  try {
    const decision = String(req.body.decision || '').trim().toLowerCase();
    const notes = String(req.body.notes || '').trim();
    const actorId = String(req.body.actor_id || 'admin_api_key').trim();

    const data = await decideFinding({
      findingId: req.params.id,
      decision,
      actorId,
      notes
    });

    if (!data) return res.status(404).json({ ok: false, error: 'Finding not found' });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/actions', async (req, res, next) => {
  try {
    const data = await listActions({
      status: String(req.query.status || '').trim().toLowerCase(),
      limit: toLimit(req.query.limit, 100, 500)
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/actions/:id/approve', async (req, res, next) => {
  try {
    const actorId = String(req.body.actor_id || 'admin_api_key').trim();
    const data = await approveAction({ actionId: req.params.id, actorId });
    if (!data) return res.status(404).json({ ok: false, error: 'Action not found or not approvable' });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/actions/:id/execute', requireSuperAdminKey, async (req, res, next) => {
  try {
    const actorId = String(req.body.actor_id || 'super_admin_key').trim();
    const data = await executeAction({ actionId: req.params.id, actorId });
    if (!data) return res.status(404).json({ ok: false, error: 'Action not found' });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
