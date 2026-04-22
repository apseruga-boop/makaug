const db = require('../config/database');
const logger = require('../config/logger');
const { sendSupportEmail } = require('./emailService');
const { suggestWhatsappAssistantReply } = require('./aiService');

function safeInt(value, fallback = 0) {
  const n = parseInt(String(value || ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function safeText(value, max = 1000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

async function getAgentByCode(code) {
  const result = await db.query(
    `SELECT id, code, name, description, enabled, run_mode, config, created_at, updated_at
     FROM ai_agents
     WHERE code = $1
     LIMIT 1`,
    [code]
  );
  return result.rows[0] || null;
}

async function listAgents() {
  const result = await db.query(
    `SELECT id, code, name, description, enabled, run_mode, config, created_at, updated_at
     FROM ai_agents
     ORDER BY code ASC`
  );
  return result.rows;
}

async function updateAgent(agentId, updates = {}) {
  const set = [];
  const values = [agentId];
  let idx = 2;

  if (updates.enabled !== undefined) {
    set.push(`enabled = $${idx++}`);
    values.push(asBool(updates.enabled));
  }
  if (updates.run_mode !== undefined) {
    set.push(`run_mode = $${idx++}`);
    values.push(String(updates.run_mode || 'recommend').trim().toLowerCase());
  }
  if (updates.config !== undefined) {
    set.push(`config = $${idx++}::jsonb`);
    values.push(JSON.stringify(updates.config || {}));
  }

  if (!set.length) {
    throw new Error('No updates provided');
  }

  const result = await db.query(
    `UPDATE ai_agents
     SET ${set.join(', ')}, updated_at = NOW()
     WHERE id = $1
     RETURNING id, code, name, description, enabled, run_mode, config, updated_at`,
    values
  );

  return result.rows[0] || null;
}

async function insertRun({ agent, triggerSource = 'manual', createdBy = 'admin_api_key', inputPayload = {} }) {
  const result = await db.query(
    `INSERT INTO ai_agent_runs (agent_id, trigger_source, status, input_payload, created_by)
     VALUES ($1, $2, 'started', $3::jsonb, $4)
     RETURNING id, agent_id, trigger_source, status, input_payload, output_summary, started_at, finished_at, created_at`,
    [agent.id, triggerSource, JSON.stringify(inputPayload || {}), createdBy]
  );
  return result.rows[0];
}

async function finalizeRun({ runId, status = 'completed', outputSummary = {}, errorMessage = null }) {
  const result = await db.query(
    `UPDATE ai_agent_runs
     SET status = $2,
         output_summary = $3::jsonb,
         error_message = $4,
         finished_at = NOW()
     WHERE id = $1
     RETURNING id, status, output_summary, error_message, started_at, finished_at`,
    [runId, status, JSON.stringify(outputSummary || {}), errorMessage]
  );
  return result.rows[0] || null;
}

async function insertFinding({ runId, agentId, finding }) {
  const result = await db.query(
    `INSERT INTO ai_agent_findings (
      run_id, agent_id, entity_type, entity_id, severity, finding_type, message, recommendation
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING id, run_id, agent_id, entity_type, entity_id, severity, finding_type, message, recommendation, status, created_at`,
    [
      runId,
      agentId,
      safeText(finding.entity_type, 60),
      safeText(finding.entity_id, 120),
      safeText(finding.severity, 20).toLowerCase() || 'medium',
      safeText(finding.finding_type, 120),
      safeText(finding.message, 1500),
      JSON.stringify(finding.recommendation || {})
    ]
  );
  return result.rows[0];
}

async function createActionFromFinding({ findingId, recommendation = {} }) {
  const actionType = safeText(recommendation.action_type, 120);
  if (!actionType) return null;

  const actionPayload = recommendation.action_payload && typeof recommendation.action_payload === 'object'
    ? recommendation.action_payload
    : {};

  const result = await db.query(
    `INSERT INTO ai_agent_actions (finding_id, action_type, action_payload, status)
     VALUES ($1, $2, $3::jsonb, 'pending')
     RETURNING id, finding_id, action_type, action_payload, status, created_at`,
    [findingId, actionType, JSON.stringify(actionPayload)]
  );
  return result.rows[0] || null;
}

function mergeConfig(agentConfig, fallback) {
  if (!agentConfig || typeof agentConfig !== 'object') return { ...fallback };
  return { ...fallback, ...agentConfig };
}

async function runListingQualityGuard({ agent, limit = 40 }) {
  const config = mergeConfig(agent.config, {
    minDescriptionLength: 80,
    minPhotos: 5
  });

  const rows = await db.query(
    `SELECT
       p.id,
       p.title,
       p.status,
       p.lister_email,
       p.latitude,
       p.longitude,
       CHAR_LENGTH(COALESCE(p.description, ''))::int AS description_length,
       COALESCE(img.photo_count, 0)::int AS photo_count
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS photo_count
       FROM property_images
       WHERE property_id = p.id
     ) img ON TRUE
     WHERE p.status = 'pending'
     ORDER BY p.created_at ASC
     LIMIT $1`,
    [limit]
  );

  const findings = [];
  for (const row of rows.rows) {
    if (row.description_length < safeInt(config.minDescriptionLength, 80)) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'medium',
        finding_type: 'weak_description',
        message: `Listing "${row.title}" has a short description (${row.description_length} chars).`,
        recommendation: row.lister_email
          ? {
              action_type: 'send_support_email',
              action_payload: {
                to: row.lister_email,
                subject: 'Please improve your MakaUg listing description',
                text: 'Your listing description is too short. Please add key details (features, road access, nearby amenities, and condition) before approval.'
              }
            }
          : {}
      });
    }

    if (row.photo_count < safeInt(config.minPhotos, 5)) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'high',
        finding_type: 'insufficient_photos',
        message: `Listing "${row.title}" has ${row.photo_count} photos. Minimum is ${safeInt(config.minPhotos, 5)}.`,
        recommendation: row.lister_email
          ? {
              action_type: 'send_support_email',
              action_payload: {
                to: row.lister_email,
                subject: 'Add required photos to your MakaUg listing',
                text: 'Your listing needs at least 5 clear photos (front, living area, bedroom, kitchen, bathroom) before approval.'
              }
            }
          : {}
      });
    }

    if (row.latitude == null || row.longitude == null) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'medium',
        finding_type: 'missing_map_coordinates',
        message: `Listing "${row.title}" has no latitude/longitude pin.`,
        recommendation: {}
      });
    }
  }

  return {
    findings,
    summary: {
      checked_properties: rows.rows.length,
      findings_count: findings.length
    }
  };
}

async function runIdMatchGuard({ agent, limit = 40 }) {
  const config = mergeConfig(agent.config, {
    ninRegex: '^(CM|CF|PM|PF)[A-Z0-9]{12}$'
  });
  const ninRegex = new RegExp(config.ninRegex, 'i');

  const rows = await db.query(
    `SELECT id, title, lister_email, id_number, id_document_name, id_document_url
     FROM properties
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  const findings = [];
  for (const row of rows.rows) {
    if (!row.id_number || !ninRegex.test(String(row.id_number || '').trim())) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'high',
        finding_type: 'invalid_nin_format',
        message: `Listing "${row.title}" has invalid or missing NIN format.`,
        recommendation: row.lister_email
          ? {
              action_type: 'send_support_email',
              action_payload: {
                to: row.lister_email,
                subject: 'NIN verification needed for your MakaUg listing',
                text: 'Please provide a valid Uganda NIN format (for example starting with CM/CF) so we can continue review.'
              }
            }
          : {}
      });
    }

    if (!row.id_document_name || !row.id_document_url) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'critical',
        finding_type: 'missing_id_document',
        message: `Listing "${row.title}" has no viewable uploaded ID document.`,
        recommendation: {}
      });
    }
  }

  return {
    findings,
    summary: {
      checked_properties: rows.rows.length,
      findings_count: findings.length
    }
  };
}

async function runImageIntegrityGuard({ agent, limit = 60 }) {
  const _config = mergeConfig(agent.config, { maxDuplicateListingsPerImage: 1 });

  const dupRows = await db.query(
    `SELECT
       pi.url,
       ARRAY_AGG(DISTINCT pi.property_id)::text[] AS property_ids,
       COUNT(DISTINCT pi.property_id)::int AS listing_count
     FROM property_images pi
     JOIN properties p ON p.id = pi.property_id
     WHERE p.status IN ('pending', 'approved')
     GROUP BY pi.url
     HAVING COUNT(DISTINCT pi.property_id) > 1
     ORDER BY COUNT(DISTINCT pi.property_id) DESC
     LIMIT $1`,
    [limit]
  );

  const findings = [];
  for (const row of dupRows.rows) {
    const ids = Array.isArray(row.property_ids) ? row.property_ids : [];
    ids.forEach((propertyId) => {
      findings.push({
        entity_type: 'property',
        entity_id: propertyId,
        severity: 'high',
        finding_type: 'duplicate_image_url',
        message: `Property image URL appears in ${row.listing_count} different listings.`,
        recommendation: {
          action_type: 'set_property_status',
          action_payload: {
            property_id: propertyId,
            status: 'pending',
            reason: 'duplicate_image_detected_by_ai_agent'
          }
        }
      });
    });
  }

  return {
    findings,
    summary: {
      duplicate_image_groups: dupRows.rows.length,
      findings_count: findings.length
    }
  };
}

async function runSupportTriageAssistant({ agent, limit = 30 }) {
  const _config = mergeConfig(agent.config, { maxReportsPerRun: 30 });

  const reportRows = await db.query(
    `SELECT id, property_reference, reason, details, status
     FROM listing_reports
     WHERE status IN ('open', 'in_review')
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  const findings = [];

  for (const report of reportRows.rows) {
    const aiReply = await suggestWhatsappAssistantReply({
      userMessage: `Create a short support response for listing report ${report.id}. Reason: ${report.reason}. Details: ${safeText(report.details, 400)}`,
      intent: 'report_listing',
      language: 'en',
      context: {
        property_reference: report.property_reference,
        report_id: report.id
      },
      source: 'support_triage_assistant'
    });

    findings.push({
      entity_type: 'listing_report',
      entity_id: report.id,
      severity: 'low',
      finding_type: 'support_reply_draft',
      message: `Draft support response generated for report ${report.id}.`,
      recommendation: {
        action_type: 'draft_support_reply',
        action_payload: {
          report_id: report.id,
          property_reference: report.property_reference,
          draft_reply: aiReply.text
        }
      }
    });
  }

  return {
    findings,
    summary: {
      checked_reports: reportRows.rows.length,
      findings_count: findings.length
    }
  };
}

async function runAgentChecks({ agent, limit = 40 }) {
  if (agent.code === 'listing_quality_guard') return runListingQualityGuard({ agent, limit });
  if (agent.code === 'id_match_guard') return runIdMatchGuard({ agent, limit });
  if (agent.code === 'image_integrity_guard') return runImageIntegrityGuard({ agent, limit });
  if (agent.code === 'support_triage_assistant') return runSupportTriageAssistant({ agent, limit });

  return {
    findings: [],
    summary: {
      skipped: true,
      reason: `No handler implemented for ${agent.code}`
    }
  };
}

async function runAgent({ agentCode, triggerSource = 'manual', createdBy = 'admin_api_key', limit = 40 }) {
  const agent = await getAgentByCode(agentCode);
  if (!agent) {
    throw new Error(`Agent not found: ${agentCode}`);
  }

  const run = await insertRun({
    agent,
    triggerSource,
    createdBy,
    inputPayload: { limit }
  });

  try {
    const output = await runAgentChecks({ agent, limit });
    const insertedFindings = [];

    for (const finding of output.findings || []) {
      const inserted = await insertFinding({
        runId: run.id,
        agentId: agent.id,
        finding
      });
      insertedFindings.push(inserted);

      if (agent.run_mode === 'recommend' || agent.run_mode === 'auto') {
        await createActionFromFinding({
          findingId: inserted.id,
          recommendation: inserted.recommendation
        });
      }
    }

    const summary = {
      ...(output.summary || {}),
      findings_created: insertedFindings.length,
      run_mode: agent.run_mode
    };

    const finalized = await finalizeRun({
      runId: run.id,
      status: 'completed',
      outputSummary: summary
    });

    return {
      agent,
      run: finalized,
      findings: insertedFindings
    };
  } catch (error) {
    logger.error('AI agent run failed', { agent: agent.code, error: error.message });
    const finalized = await finalizeRun({
      runId: run.id,
      status: 'failed',
      outputSummary: { failed: true },
      errorMessage: error.message
    });
    return {
      agent,
      run: finalized,
      findings: []
    };
  }
}

async function runAllEnabledAgents({ triggerSource = 'manual', createdBy = 'admin_api_key', limit = 40 }) {
  const agents = await db.query(
    `SELECT id, code, name, description, enabled, run_mode, config
     FROM ai_agents
     WHERE enabled = TRUE
     ORDER BY code ASC`
  );

  const results = [];
  for (const agent of agents.rows) {
    // sequential by design to control DB load and keep audit order deterministic
    // eslint-disable-next-line no-await-in-loop
    const result = await runAgent({
      agentCode: agent.code,
      triggerSource,
      createdBy,
      limit
    });
    results.push(result);
  }
  return results;
}

async function listRuns({ limit = 50 }) {
  const result = await db.query(
    `SELECT
       r.id,
       r.agent_id,
       a.code AS agent_code,
       a.name AS agent_name,
       r.trigger_source,
       r.status,
       r.input_payload,
       r.output_summary,
       r.error_message,
       r.created_by,
       r.started_at,
       r.finished_at,
       r.created_at
     FROM ai_agent_runs r
     JOIN ai_agents a ON a.id = r.agent_id
     ORDER BY r.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function listFindings({ status = '', severity = '', agentCode = '', limit = 100 }) {
  const filters = [];
  const values = [];

  if (status) {
    values.push(status);
    filters.push(`f.status = $${values.length}`);
  }
  if (severity) {
    values.push(severity);
    filters.push(`f.severity = $${values.length}`);
  }
  if (agentCode) {
    values.push(agentCode);
    filters.push(`a.code = $${values.length}`);
  }

  values.push(limit);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT
       f.id,
       f.run_id,
       f.agent_id,
       a.code AS agent_code,
       a.name AS agent_name,
       f.entity_type,
       f.entity_id,
       f.severity,
       f.finding_type,
       f.message,
       f.recommendation,
       f.status,
       f.notes,
       f.resolved_by,
       f.resolved_at,
       f.created_at
     FROM ai_agent_findings f
     JOIN ai_agents a ON a.id = f.agent_id
     ${where}
     ORDER BY f.created_at DESC
     LIMIT $${values.length}`,
    values
  );

  return result.rows;
}

async function decideFinding({ findingId, decision, actorId = 'admin_api_key', notes = '' }) {
  const normalized = String(decision || '').trim().toLowerCase();
  if (!['accepted', 'dismissed', 'resolved'].includes(normalized)) {
    throw new Error('Invalid decision');
  }

  const updated = await db.query(
    `UPDATE ai_agent_findings
     SET status = $2,
         notes = $3,
         resolved_by = $4,
         resolved_at = NOW()
     WHERE id = $1
     RETURNING id, recommendation, status, resolved_by, resolved_at`,
    [findingId, normalized, safeText(notes, 1200) || null, actorId]
  );

  const finding = updated.rows[0];
  if (!finding) return null;

  let action = null;
  if (normalized === 'accepted') {
    action = await createActionFromFinding({
      findingId: finding.id,
      recommendation: finding.recommendation
    });
  }

  return {
    finding,
    action
  };
}

async function listActions({ status = '', limit = 100 }) {
  const values = [];
  let where = '';
  if (status) {
    values.push(status);
    where = `WHERE a.status = $1`;
  }
  values.push(limit);

  const result = await db.query(
    `SELECT
       a.id,
       a.finding_id,
       a.action_type,
       a.action_payload,
       a.status,
       a.approved_by,
       a.executed_by,
       a.result_payload,
       a.error_message,
       a.created_at,
       a.updated_at
     FROM ai_agent_actions a
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

async function approveAction({ actionId, actorId = 'admin_api_key' }) {
  const result = await db.query(
    `UPDATE ai_agent_actions
     SET status = 'approved',
         approved_by = $2,
         updated_at = NOW()
     WHERE id = $1
       AND status IN ('pending', 'failed')
     RETURNING id, action_type, action_payload, status, approved_by, updated_at`,
    [actionId, actorId]
  );
  return result.rows[0] || null;
}

async function executeAction({ actionId, actorId = 'super_admin_key' }) {
  const actionResult = await db.query(
    `SELECT id, action_type, action_payload, status
     FROM ai_agent_actions
     WHERE id = $1
     LIMIT 1`,
    [actionId]
  );
  const action = actionResult.rows[0];
  if (!action) return null;

  if (!['approved', 'pending', 'failed'].includes(action.status)) {
    throw new Error('Action is not executable in current state');
  }

  const payload = action.action_payload && typeof action.action_payload === 'object'
    ? action.action_payload
    : {};

  try {
    let resultPayload = {};

    if (action.action_type === 'set_property_status') {
      const propertyId = safeText(payload.property_id, 120);
      const status = safeText(payload.status, 30).toLowerCase();
      const reason = safeText(payload.reason, 500);

      if (!propertyId || !status) throw new Error('set_property_status missing property_id or status');

      const updated = await db.query(
        `UPDATE properties
         SET status = $2,
             reviewed_at = NOW(),
             extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('ai_action_reason', $3)
         WHERE id = $1
         RETURNING id, status, reviewed_at`,
        [propertyId, status, reason || null]
      );

      resultPayload = {
        updated: updated.rows[0] || null
      };
    } else if (action.action_type === 'send_support_email') {
      const emailResult = await sendSupportEmail({
        to: payload.to || process.env.SUPPORT_EMAIL || 'info@makaug.com',
        subject: safeText(payload.subject, 200) || 'MakaUg follow-up',
        text: safeText(payload.text, 5000) || 'No message body provided.'
      });

      resultPayload = {
        email: emailResult
      };
    } else if (action.action_type === 'update_agent_status') {
      const agentId = safeText(payload.agent_id, 120);
      const status = safeText(payload.status, 30).toLowerCase();
      if (!agentId || !status) throw new Error('update_agent_status missing agent_id or status');

      const updated = await db.query(
        `UPDATE agents
         SET status = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, updated_at`,
        [agentId, status]
      );

      resultPayload = {
        updated: updated.rows[0] || null
      };
    } else if (action.action_type === 'draft_support_reply') {
      resultPayload = {
        draft: payload
      };
    } else {
      throw new Error(`Unsupported action_type: ${action.action_type}`);
    }

    const updatedAction = await db.query(
      `UPDATE ai_agent_actions
       SET status = 'executed',
           executed_by = $2,
           result_payload = $3::jsonb,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, action_type, status, executed_by, result_payload, updated_at`,
      [action.id, actorId, JSON.stringify(resultPayload)]
    );

    if (action.finding_id) {
      await db.query(
        `UPDATE ai_agent_findings
         SET status = 'resolved',
             resolved_by = $2,
             resolved_at = NOW(),
             notes = COALESCE(notes, '') || CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END || 'Resolved by AI action execution.'
         WHERE id = $1`,
        [action.finding_id, actorId]
      );
    }

    return updatedAction.rows[0] || null;
  } catch (error) {
    await db.query(
      `UPDATE ai_agent_actions
       SET status = 'failed',
           executed_by = $2,
           error_message = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [action.id, actorId, safeText(error.message, 1000)]
    );
    throw error;
  }
}

module.exports = {
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
};
