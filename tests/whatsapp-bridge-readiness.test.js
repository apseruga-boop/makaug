const assert = require('assert');

const {
  evaluateHostedWhatsappBridgeReadiness
} = require('../services/whatsappBridgeReadiness');

const now = new Date('2026-07-04T04:20:00.000Z');

const hostedWaitingForLogin = {
  client_id: 'makaug-whatsapp-web-prod',
  status: 'waiting_for_login',
  current_url: 'https://web.whatsapp.com/',
  last_seen_at: now.toISOString(),
  metadata: {
    runtime: 'render_worker',
    deploy_target: 'render',
    ready_state: {
      waitingForLogin: true,
      loginPrompt: true
    }
  }
};

const localResponder = {
  client_id: 'makaug-whatsapp-web',
  status: 'online',
  current_url: 'https://web.whatsapp.com/',
  last_seen_at: now.toISOString(),
  metadata: {
    runtime: 'local_browser',
    deploy_target: 'local',
    ready_state: {
      ready: true,
      hasChatList: true,
      hasComposer: true
    }
  }
};

const degraded = evaluateHostedWhatsappBridgeReadiness([
  hostedWaitingForLogin,
  localResponder
], { now });

assert.strictEqual(degraded.ok, true);
assert.strictEqual(degraded.status, 'degraded_local_fallback');
assert.strictEqual(degraded.reason, 'hosted_agent_blocked_local_fallback_online');
assert.strictEqual(degraded.hosted_blocker, 'status_waiting_for_login');
assert.strictEqual(degraded.local_online_count, 1);
assert.strictEqual(degraded.selected_client.client_id, 'makaug-whatsapp-web');

const blocked = evaluateHostedWhatsappBridgeReadiness([
  hostedWaitingForLogin
], { now });

assert.strictEqual(blocked.ok, false);
assert.strictEqual(blocked.status, 'blocked');
assert.strictEqual(blocked.reason, 'status_waiting_for_login');

console.log('WhatsApp bridge readiness fallback ok');
