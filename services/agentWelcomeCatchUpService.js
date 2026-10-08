'use strict';

// Agents approved in the last two weeks who never got their welcome pack:
// send it (then the pay link), one agent at a time, and never render a video
// here — start-up is when memory is tightest. A film is used only if it was
// already made; otherwise the welcome goes without it.

async function runWelcomeCatchUp({ db, runFollowUps, logger = console, limit = 20 } = {}) {
  const missed = (await db.query(
    `SELECT id, full_name FROM agents
      WHERE status = 'approved' AND removed_at IS NULL AND welcome_sent_at IS NULL
        AND approved_at > NOW() - INTERVAL '14 days'
      ORDER BY approved_at
      LIMIT $1`,
    [limit]
  )).rows;
  const summary = { found: missed.length, processed: 0, failed: 0 };
  for (const agent of missed) {
    const result = await runFollowUps({ agentId: agent.id, wasApproved: true, actor: 'system:approval_catch_up', allowVideoRender: false })
      .catch((error) => ({ error: error.message }));
    summary.processed += 1;
    if (result?.error || result?.welcome?.error) summary.failed += 1;
    logger.info('Sent missed agent welcome pack', {
      agent_id: agent.id,
      name: agent.full_name,
      format: result?.welcome?.format || null,
      fee_link: result?.fee_link || null,
      error: result?.error || result?.welcome?.error || null
    });
  }
  return summary;
}

module.exports = { runWelcomeCatchUp };
