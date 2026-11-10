'use strict';

/**
 * agent_added
 *
 * Emitted after King/staff save an agent by hand. Payload (no phone number):
 *   { agent_id, status, payment_status, added_by_name }
 *
 * The same payload is written to audit_logs with action 'agent_added', so a
 * separate process can see it without sharing this Node process.
 *
 * WhatsApp (owned by another team — do not edit WhatsApp code for this):
 *   Nothing is sent from the Add agent form. To send the welcome an approved
 *   agent already gets, call the existing helper outside the WhatsApp module:
 *
 *     const { queueAgentWelcomePack } = require('../routes/admin');
 *     await queueAgentWelcomePack({ agentId });
 *
 *   Use the agent_id from this event. Send only when status is 'approved'.
 *   queueAgentWelcomePack is exported from routes/admin.js and is the same
 *   path used when an agent is approved.
 *
 * Subscribe in-process:
 *   const { onAgentAdded } = require('../services/agentAddedHook');
 *   const stop = onAgentAdded(async ({ agent_id, status }) => { ... });
 */

const listeners = new Set();

function onAgentAdded(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function emitAgentAdded(event = {}) {
  const payload = {
    agent_id: String(event.agent_id || ''),
    status: String(event.status || ''),
    payment_status: String(event.payment_status || ''),
    added_by_name: String(event.added_by_name || '')
  };
  for (const listener of listeners) {
    try {
      await listener({ ...payload });
    } catch (_) {
      // A welcome subscriber must not undo the save.
    }
  }
  return payload;
}

module.exports = { emitAgentAdded, onAgentAdded };
