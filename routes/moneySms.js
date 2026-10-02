'use strict';

/**
 * POST /api/money-sms/inbound?token=…
 *
 * The phone that holds the makaug MoMo SIM forwards its money SMS here with a
 * free Android SMS-forwarder app. The token is MONEY_SMS_WEBHOOK_TOKEN; without
 * it set, the endpoint is closed.
 */

const crypto = require('crypto');
const express = require('express');
const db = require('../config/database');
const revenue = require('../services/revenueService');

const router = express.Router();

function tokenOk(req) {
  const expected = String(process.env.MONEY_SMS_WEBHOOK_TOKEN || '').trim();
  if (expected.length < 16) return false;
  const given = String(req.query.token || req.headers['x-money-sms-token'] || req.body?.token || '').trim();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/inbound', express.text({ type: 'text/*', limit: '32kb' }), async (req, res) => {
  if (!tokenOk(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const payload = typeof req.body === 'string' ? { text: req.body } : (req.body || {});
    const body = String(payload.text || payload.message || payload.body || payload.msg || '').trim();
    const sender = String(payload.from || payload.sender || payload.address || '').trim();
    const stamp = Number(payload.sentStamp || payload.receivedStamp || payload.timestamp || 0);
    const receivedAt = stamp > 1e12 ? new Date(stamp).toISOString() : (stamp > 1e9 ? new Date(stamp * 1000).toISOString() : null);
    const result = await revenue.ingestMoneySms(db, {
      body,
      sender,
      receivedAt,
      accountKey: String(req.query.account || payload.account || '').trim() || null,
      raw: { device: payload.device || payload.sim || null }
    });
    if (!result.duplicate && result.parsed?.direction === 'in' && !result.matched && result.parsed.amount_ugx) {
      setImmediate(async () => {
        try {
          const desk = require('../services/leadDeskService');
          const p = result.parsed;
          await desk.sendToTeam(db, [
            `📲 *Money received on ${p.account_key === 'airtel_money' ? 'Airtel Money' : 'MoMo'}* — not recorded yet`,
            `UGX ${Number(p.amount_ugx).toLocaleString('en-US')}${p.counterparty ? ` from ${p.counterparty}` : ''}`,
            p.reference ? `Transaction ID: ${p.reference}` : '',
            'Record who paid it in Admin › Sales & Revenue.'
          ].filter(Boolean).join('\n'), 'money_sms_unrecorded');
        } catch (_ignored) { /* best effort */ }
      });
    }
    return res.json({ ok: true, duplicate: Boolean(result.duplicate), matched: Boolean(result.matched) });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : 'failed' });
  }
});

module.exports = router;
