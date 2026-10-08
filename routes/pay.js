'use strict';

/**
 * Public payment pages: makaug.com/pay/<code>.
 *
 * Works with or without JavaScript: every button is a plain form post, so a
 * cheap phone on a slow connection can pay as easily as anyone else.
 */

const express = require('express');

const db = require('../config/database');
const PRICING = require('../config/pricing');
const logger = require('../config/logger');
const payLinks = require('../services/payLinkService');
const revolut = require('../services/revolutMerchantService');

const pages = express.Router();
const api = express.Router();

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function prettyNumber(raw) {
  const d = String(raw || '').replace(/\D+/g, '');
  if (d.length === 12 && d.startsWith('256')) return `0${d.slice(3, 6)} ${d.slice(6)}`;
  if (d.length === 10 && d.startsWith('0')) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return String(raw || '');
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · makaug</title>
<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--green:#15603f;--green-soft:#e4ece8;--ink:#16241d;--muted:#5b6b62;--line:#dfe7e2;--bg:#f6f9f7;--accent:#b3134f;--card:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Plus Jakarta Sans",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.45}
.wrap{max-width:480px;margin:0 auto;padding:20px 16px 48px}
.brand{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.brand a{font-weight:800;font-size:22px;color:var(--green);text-decoration:none;letter-spacing:-.5px}
.brand span{font-size:12px;color:var(--muted)}
.due{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px}
.due small{display:block;color:var(--muted);font-size:13px}
.due h1{font-size:16px;font-weight:700;margin:4px 0 10px}
.amount{font-size:34px;font-weight:800;letter-spacing:-1px}
.ref{margin-top:6px;font-size:12px;color:var(--muted)}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:26px 4px 10px}
.opt{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:12px}
.opt h3{margin:0 0 4px;font-size:17px}
.opt p{margin:0 0 12px;color:var(--muted);font-size:14px}
.btn{display:block;width:100%;border:0;border-radius:12px;padding:15px 16px;font:inherit;font-weight:800;font-size:16px;cursor:pointer;text-align:center;text-decoration:none}
.btn-card{background:var(--ink);color:#fff}
.btn-momo{background:#ffcb05;color:#16241d}
.btn:disabled{opacity:.5;cursor:not-allowed}
.marks{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.marks span{font-size:11px;font-weight:700;border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:var(--ink)}
.steps{margin:0 0 12px;padding-left:20px;font-size:14px}
.steps li{margin-bottom:6px}
.code{font-family:ui-monospace,Menlo,monospace;font-weight:800;background:var(--green-soft);border-radius:6px;padding:1px 6px}
label{display:block;font-size:13px;font-weight:700;margin-bottom:6px}
input{width:100%;border:1px solid var(--line);border-radius:10px;padding:13px 12px;font:inherit;font-size:16px;margin-bottom:10px;background:#fff;color:var(--ink)}
input:focus{outline:2px solid var(--green);outline-offset:1px}
.note{font-size:12px;color:var(--muted);margin-top:10px}
.ok{background:var(--green);color:#fff;border-radius:18px;padding:22px 18px;text-align:center}
.ok .tick{font-size:42px;line-height:1}
.ok h1{margin:8px 0 4px;font-size:22px}
.ok p{margin:0;opacity:.9}
.warn{background:#fff7e6;border:1px solid #f3d38a;border-radius:12px;padding:12px;font-size:14px;margin-top:12px}
.err{background:#fdecef;border:1px solid #f4b7c6;color:#7a0d33;border-radius:12px;padding:12px;font-size:14px;margin:12px 0}
footer{margin-top:28px;text-align:center;font-size:12px;color:var(--muted)}
footer a{color:var(--muted)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#eef4f0;--muted:#a7b5ad;--line:#2b3a32;--bg:#0f1712;--card:#16211b;--green-soft:#1f3a2c}
:root:not([data-theme="light"]) .btn-card{background:#eef4f0;color:#0f1712}
:root:not([data-theme="light"]) input{background:#0f1712}
:root:not([data-theme="light"]) .warn{background:#2b2410;border-color:#5a4a1c}
:root:not([data-theme="light"]) .err{background:#3a1420;border-color:#6d2238;color:#ffd0dc}}
</style></head>
<body><main class="wrap">
<div class="brand"><a href="/">makaug</a><span>Secure payment</span></div>
${body}
<footer>Questions? WhatsApp makaug on <a href="https://wa.me/256780863394">0780 863394</a></footer>
</main></body></html>`;
}

function paidView(d) {
  const how = d.paid_method === 'card' ? 'by card' : (d.paid_method === 'mtn_momo' ? 'by mobile money' : '');
  return layout('Paid', `
<div class="ok"><div class="tick">✓</div><h1>Paid — thank you${d.payer_first_name ? `, ${esc(d.payer_first_name)}` : ''}!</h1>
<p>${esc(d.amount_ugx_text)} ${esc(how)} for ${esc(d.description)}.</p></div>
<p class="note" style="text-align:center">You'll also get a confirmation on WhatsApp. Reference ${esc(d.code)}.</p>`);
}

function openView(d, { error = '', claimed = false, cardCancelled = false } = {}) {
  const payTo = d.pay_to || {};
  const momoNumber = prettyNumber(payTo.number);
  const momoName = String(payTo.name || '').trim();
  const cardBlock = d.card_available ? `
<div class="opt">
  <h3>💳 Card, Apple Pay or Google Pay</h3>
  <p>Pay <strong>${esc(d.card_text)}</strong> (US dollars, the card equivalent of ${esc(d.amount_ugx_text)}). Visa and Mastercard from any country.</p>
  <div class="marks"><span>Visa</span><span>Mastercard</span><span>Apple Pay</span><span>Google Pay</span></div>
  <form method="post" action="/pay/${esc(d.code)}/card"><button class="btn btn-card" type="submit">Pay ${esc(d.card_text)} by card</button></form>
  ${cardCancelled ? '<div class="warn">The card payment was not completed. You can try again, or pay by mobile money below.</div>' : ''}
  <p class="note">Processed securely by Revolut. Your card statement will show <strong>WHISPERS GLOBAL</strong>, the company that runs makaug's card payments.</p>
</div>` : '';
  const momoBlock = d.pay_to_ready ? `
<div class="opt">
  <h3>📱 MTN Mobile Money</h3>
  <ol class="steps">
    <li>Send <strong>${esc(d.amount_ugx_text)}</strong> to <strong>${esc(momoNumber)}</strong>${momoName ? ` (<strong>${esc(momoName)}</strong>)` : ''}.</li>
    <li>If asked for a reason or reference, use <span class="code">${esc(d.code)}</span>.</li>
    <li>Type the transaction ID from your MoMo SMS below.</li>
  </ol>
  ${claimed ? `<div class="warn">✓ Got it — we're checking your payment against the MoMo message and will confirm on WhatsApp shortly.</div>` : `
  <form method="post" action="/pay/${esc(d.code)}/momo">
    <label for="ref">Transaction ID</label>
    <input id="ref" name="reference" inputmode="text" autocomplete="off" required minlength="5" maxlength="60" placeholder="e.g. 12345678901">
    <button class="btn btn-momo" type="submit">I have paid</button>
  </form>`}
</div>` : '';
  const nothing = !cardBlock && !momoBlock ? '<div class="warn">Payment options are being set up. Please WhatsApp us and we will help you pay.</div>' : '';
  return layout('Pay', `
<section class="due">
  <small>Payment for</small>
  <h1>${esc(d.description)}</h1>
  <div class="amount">${esc(d.amount_ugx_text)}</div>
  <div class="ref">${esc(PRICING.vat.label)}</div>
  <div class="ref">Reference ${esc(d.code)}</div>
</section>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<h2>Choose how to pay</h2>
${cardBlock}${momoBlock}${nothing}`);
}

function notFoundView() {
  return layout('Link not found', `<section class="due"><h1>This payment link isn't valid</h1><p class="note">Please check the link in your WhatsApp message, or contact makaug.</p></section>`);
}

function send(res, status, html) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).type('html').send(html);
}

pages.get('/:code', async (req, res, next) => {
  try {
    let d = await payLinks.pageData(db, req.params.code);
    if (!d) return send(res, 404, notFoundView());
    if (d.status === 'cancelled') return send(res, 410, layout('Link closed', `<section class="due"><h1>This payment link has been closed</h1><p class="note">Please contact makaug for a new one.</p></section>`));
    // Coming back from Revolut without the return page? Check the order once.
    if (d.status === 'open' && req.query.paid) {
      await payLinks.refreshLink(db, d.code).catch(() => null);
      d = await payLinks.pageData(db, req.params.code);
    }
    if (d.status === 'paid' || d.status === 'settling') return send(res, 200, paidView(d));
    return send(res, 200, openView(d, { claimed: Boolean(req.query.claimed), cardCancelled: Boolean(req.query.card_cancelled) }));
  } catch (error) {
    return next(error);
  }
});

pages.post('/:code/card', async (req, res) => {
  try {
    const r = await payLinks.startCardCheckout(db, req.params.code);
    return res.redirect(303, r.redirect);
  } catch (error) {
    logger.warn('Card checkout could not start', { code: req.params.code, error: error.message });
    const d = await payLinks.pageData(db, req.params.code).catch(() => null);
    if (!d) return send(res, 404, notFoundView());
    return send(res, 200, openView(d, { error: 'Card payment could not start just now. Please try again in a minute, or pay by mobile money.' }));
  }
});

pages.get('/:code/return', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const result = await payLinks.refreshLink(db, code).catch((error) => {
    logger.warn('Return check failed', { code, error: error.message });
    return { paid: false };
  });
  if (result.paid) return res.redirect(303, `/pay/${encodeURIComponent(code)}`);
  return res.redirect(303, `/pay/${encodeURIComponent(code)}?card_cancelled=1`);
});

pages.post('/:code/momo', async (req, res) => {
  try {
    await payLinks.createMomoClaim(db, req.params.code, { reference: req.body?.reference, phone: req.body?.phone, name: req.body?.name });
    return res.redirect(303, `/pay/${encodeURIComponent(String(req.params.code).toUpperCase())}?claimed=1`);
  } catch (error) {
    const d = await payLinks.pageData(db, req.params.code).catch(() => null);
    if (!d) return send(res, 404, notFoundView());
    if (d.status === 'paid') return send(res, 200, paidView(d));
    return send(res, 200, openView(d, { error: error.status && error.status < 500 ? error.message : 'Something went wrong. Please try again.' }));
  }
});

// Revolut tells us an order changed. We verify the signature when we have the
// secret, and in every case ask Revolut for the order before recording money.
api.post('/webhooks/revolut', async (req, res) => {
  try {
    const secret = await payLinks.webhookSecret(db);
    if (secret) {
      const ok = revolut.verifySignature({
        rawBody: req.rawBody ? req.rawBody.toString('utf8') : '',
        signatureHeader: req.get('Revolut-Signature'),
        timestampHeader: req.get('Revolut-Request-Timestamp'),
        secret
      });
      if (!ok) {
        logger.warn('Revolut webhook signature did not match');
        return res.status(401).json({ ok: false });
      }
    }
    const result = await payLinks.handleRevolutEvent(db, req.body || {});
    return res.json({ ok: true, result });
  } catch (error) {
    logger.error('Revolut webhook failed', { error: error.message });
    // 5xx makes Revolut retry, which is what we want if our database blinked.
    return res.status(500).json({ ok: false });
  }
});

module.exports = { pages, api, openView, paidView };
