#!/usr/bin/env node
'use strict';

require('dotenv').config();

const {
  AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY,
  buildAgentWelcomeWhatsappMessage
} = require('../services/outreachTemplateService');

function argValue(name) {
  const prefix = `${name}=`;
  const direct = process.argv.find((item) => item.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return '';
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return raw.startsWith('+') ? `+${digits}` : `+${digits}`;
}

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 'unknown';
  return `***${digits.slice(-4)}`;
}

async function main() {
  const baseUrl = String(argValue('--base-url') || process.env.AGENT_WELCOME_TEST_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
  const to = normalizePhone(argValue('--to') || process.env.AGENT_WELCOME_TEST_TO || '');
  const name = argValue('--name') || process.env.AGENT_WELCOME_TEST_NAME || 'Arthur';
  const source = argValue('--source') || process.env.AGENT_WELCOME_TEST_SOURCE || '';
  const send = process.argv.includes('--send');
  const apiKey = process.env.ADMIN_API_KEY || '';
  const body = buildAgentWelcomeWhatsappMessage({ name, source });

  const preview = {
    to: maskPhone(to),
    name,
    template_key: AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY,
    chars: body.length,
    body
  };

  if (!send) {
    console.log(JSON.stringify({ ok: true, mode: 'preview', data: preview }, null, 2));
    return;
  }

  if (!to) throw new Error('Missing --to or AGENT_WELCOME_TEST_TO');
  if (!apiKey) throw new Error('Missing ADMIN_API_KEY');

  const response = await fetch(`${baseUrl}/api/admin/outreach/whatsapp/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({
      to,
      name,
      source,
      reviewed: true,
      delivery_mode: 'web_bridge',
      body,
      template_key: AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY
    })
  });

  const payload = await response.json().catch(() => ({}));
  console.log(JSON.stringify({
    ok: response.ok && payload?.ok !== false,
    status: response.status,
    to: maskPhone(to),
    provider: payload?.data?.provider || null,
    queued_for_bridge: payload?.data?.queued_for_bridge === true,
    bridge_queue_id: payload?.data?.bridge_queue_id || null,
    duplicate_suppressed: payload?.data?.duplicate_suppressed === true,
    reason: payload?.reason || payload?.error || null
  }, null, 2));

  if (!response.ok || payload?.ok === false) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
