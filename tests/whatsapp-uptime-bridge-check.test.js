'use strict';

// Runs the exact `node -e` check from .github/workflows/makaug-whatsapp-uptime.yml
// against a saved copy of makaug-waha-bridge /health (8 Oct 2026, 12:55 BST).
// It must pass for that payload and fail when any one of the 4 fields is wrong.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'makaug-whatsapp-uptime.yml'), 'utf8');
const match = workflow.match(/node -e '\n([\s\S]*?)\n\s*' "\$response"/);
assert.ok(match, 'the bridge check script is in the workflow');
const CHECK = match[1];

const HEALTHY = {
  ok: true,
  waha_status: 'WORKING',
  bridge_status: 'online',
  makaug_link: { ok: true },
  ready_to_reply: true
};

function run(payload) {
  return spawnSync(process.execPath, ['-e', CHECK, JSON.stringify(payload)], { encoding: 'utf8' });
}

test('the workflow calls the bridge /health, not the orphaned runtime /ready', () => {
  assert.match(workflow, /https:\/\/makaug-waha-bridge\.onrender\.com\/health/);
  assert.doesNotMatch(workflow, /makaug-whatsapp-ai-runtime\.onrender\.com\/ready/);
  assert.match(workflow, /https:\/\/makaug\.com\/api\/health/);
  assert.match(workflow, /if: failure\(\)/);
  assert.match(workflow, /if: success\(\)/);
});

test('passes for the saved healthy payload', () => {
  const result = run(HEALTHY);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready to reply/);
});

test('fails when any one of the 4 fields is wrong', () => {
  const broken = [
    ['ready_to_reply false', { ...HEALTHY, ready_to_reply: false }, /ready_to_reply/],
    ['ready_to_reply missing', (({ ready_to_reply, ...rest }) => rest)(HEALTHY), /ready_to_reply/],
    ['waha_status STOPPED', { ...HEALTHY, waha_status: 'STOPPED' }, /waha_status/],
    ['waha_status SCAN_QR_CODE', { ...HEALTHY, waha_status: 'SCAN_QR_CODE' }, /waha_status/],
    ['bridge_status offline', { ...HEALTHY, bridge_status: 'offline' }, /bridge_status/],
    ['makaug_link.ok false', { ...HEALTHY, makaug_link: { ok: false } }, /makaug_link/],
    ['makaug_link missing', (({ makaug_link, ...rest }) => rest)(HEALTHY), /makaug_link/],
    ['ready_to_reply "true" string', { ...HEALTHY, ready_to_reply: 'true' }, /ready_to_reply/]
  ];
  for (const [label, payload, reason] of broken) {
    const result = run(payload);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, reason, label);
  }
});

test('fails on a non-JSON response', () => {
  const result = spawnSync(process.execPath, ['-e', CHECK, '<html>Service Unavailable</html>'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
});
