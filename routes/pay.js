'use strict';

/**
 * Public payment pages: makaug.com/pay/<code>.
 *
 * Works with or without JavaScript: every button is a plain form post, so a
 * cheap phone on a slow connection can pay as easily as anyone else.
 */

const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const payLinks = require('../services/payLinkService');
const revolut = require('../services/revolutMerchantService');
const billingOps = require('../services/billingOpsService');
const paymentMatch = require('../services/paymentMatchService');
const momoCard = require('../services/momoMerchantCardService');
const { momoPayCopy, momoMerchantName } = require('../config/momoMerchant');

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
.code-xl{font-size:22px;letter-spacing:.04em;padding:4px 10px;display:inline-block}
.momo-card{background:#ffcb05;color:#15213a;border-radius:16px;padding:16px;margin:0 0 14px}
.momo-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.momo-title{font-weight:800;font-size:19px;letter-spacing:-.2px}
.momo-official{font-size:11px;font-weight:800;border:2px solid #15213a;border-radius:999px;padding:3px 9px}
.momo-label{margin:14px 0 6px;font-size:11px;font-weight:800;letter-spacing:.16em}
.momo-digits{display:grid;gap:5px}
.momo-digits span{background:#fff;color:#15213a;border:2px solid #15213a;border-radius:8px;text-align:center;font-size:clamp(20px,7vw,30px);font-weight:800;padding:6px 0;font-variant-numeric:tabular-nums}
.momo-name{margin-top:10px;font-weight:800;font-size:14px;letter-spacing:.02em}
.momo-card .btn-copy{margin:12px 0 0;background:#15213a;color:#ffcb05;border-color:#15213a}
.paid-form{border-top:1px solid var(--line);margin-top:14px;padding-top:14px}
.form-title{margin:0 0 10px;font-size:15px}
.optional{font-weight:400;color:var(--muted)}
.btn-copy{display:inline-block;margin-left:8px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:8px;padding:6px 10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;vertical-align:middle}
.btn-copy:focus{outline:2px solid var(--green);outline-offset:1px}
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
</main>
<script>
document.addEventListener("click", function (event) {
  var button = event.target.closest("[data-momo-copy]");
  if (!button) return;
  var code = button.getAttribute("data-momo-copy") || "";
  var original = button.textContent;
  function copied() { button.textContent = "Copied"; setTimeout(function () { button.textContent = original; }, 1600); }
  function selectCode() {
    var el = document.getElementById("momo-code");
    if (!el) return;
    var range = document.createRange();
    range.selectNodeContents(el);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(copied).catch(selectCode);
  } else {
    selectCode();
  }
});
</script>
</body></html>`;
}

function paidView(d) {
  const how = d.paid_method === 'card' ? 'by card' : (['mtn_momo', 'mtn_momopay', 'airtel_money'].includes(d.paid_method) ? 'by mobile money' : '');
  return layout('Paid', `
<div class="ok"><div class="tick">✓</div><h1>Paid — thank you${d.payer_first_name ? `, ${esc(d.payer_first_name)}` : ''}!</h1>
<p>${esc(d.amount_ugx_text)} ${esc(how)} for ${esc(d.description)}.</p></div>
<p class="note" style="text-align:center">You'll also get a confirmation on WhatsApp.</p>`);
}

/**
 * The merchant code the way the yellow MoMo stickers show it: the code in
 * boxes and the registered name (Arthur, 10 Nov 2026 — it looks like a
 * business, and that is what makes people trust it). Fixed colours: it is the
 * same yellow card in light and dark.
 */
function momoCardHtml(code, merchantName) {
  const digits = String(code).split('');
  return `<div class="momo-card">
    <div class="momo-head"><span class="momo-title">Pay with MTN MoMo</span><span class="momo-official">Official payment details</span></div>
    <div class="momo-label">MERCHANT CODE</div>
    <div class="momo-digits" id="momo-code" aria-label="Merchant code ${esc(code)}" style="grid-template-columns:repeat(${digits.length},1fr)">${digits.map((digit) => `<span>${esc(digit)}</span>`).join('')}</div>
    <div class="momo-name">${esc(merchantName)}</div>
    <button type="button" class="btn-copy" data-momo-copy="${esc(code)}">Copy merchant code</button>
  </div>`;
}

function openView(d, { error = '', claimed = false, cardCancelled = false } = {}) {
  const cardBlock = d.card_available ? `
<div class="opt">
  <h3>💳 Card, Apple Pay or Google Pay</h3>
  <p>Pay <strong>${esc(d.card_text)}</strong> (US dollars, the card equivalent of ${esc(d.amount_ugx_text)}). Visa and Mastercard from any country.</p>
  <div class="marks"><span>Visa</span><span>Mastercard</span><span>Apple Pay</span><span>Google Pay</span></div>
  <form method="post" action="/pay/${esc(d.code)}/card"><button class="btn btn-card" type="submit">Pay ${esc(d.card_text)} by card</button></form>
  ${cardCancelled ? '<div class="warn">The card payment was not completed. You can try again, or pay by mobile money below.</div>' : ''}
  <p class="note">Processed securely by Revolut. Your card statement will show <strong>WHISPERS GLOBAL</strong>, the company that runs makaug's card payments.</p>
</div>` : '';
  const momo = d.momo || momoPayCopy();
  const merchantCode = momo.code;
  const merchantName = d.merchant_name || momoMerchantName(d.settings || {});
  // Merchant code only (Arthur, 10 Nov 2026): no "send money to a number",
  // and no reference to quote — a merchant payment does not ask for one.
  const nameLabel = d.person_payer ? 'Your name (or business name)' : 'Your business name';
  const momoBlock = merchantCode ? `
<div class="opt">
  ${momoCardHtml(merchantCode, merchantName)}
  <ol class="steps">
    <li>Dial <strong>*165*3#</strong> on your MTN phone.</li>
    <li>Select <strong>Option 1: Merchant Code</strong>.</li>
    <li>Enter merchant code <span class="code">${esc(merchantCode)}</span>.</li>
    <li>Enter <strong>${esc(d.amount_ugx_text)}</strong>.</li>
    <li>Confirm the details — you should see <strong>${esc(merchantName)}</strong> — then enter your MoMo PIN.</li>
  </ol>
  ${claimed ? `<div class="warn">✓ Thank you — we are matching your payment with our MoMo record now, and will confirm it on WhatsApp shortly.</div>` : `
  <form method="post" action="/pay/${esc(d.code)}/momo" class="paid-form">
    <h3 class="form-title">Paid? Tell us it was you</h3>
    <label for="biz">${esc(nameLabel)}</label>
    <input id="biz" name="business_name" required maxlength="120" autocomplete="organization" value="${esc(d.business_name_hint || '')}" placeholder="e.g. Kato Homes">
    <label for="phone">The number you paid from</label>
    <input id="phone" name="phone" inputmode="tel" required maxlength="20" autocomplete="tel" value="${esc(d.payer_phone_hint || '')}" placeholder="e.g. 0772 123 456">
    <label for="ref">Transaction ID <span class="optional">(optional)</span></label>
    <input id="ref" name="reference" inputmode="text" autocomplete="off" maxlength="60" placeholder="From your MoMo SMS, if you have it">
    <button class="btn btn-momo" type="submit">I have paid</button>
    <p class="note">No reference needed. We match your payment by your name and the number you paid from, then confirm it on WhatsApp.</p>
  </form>`}
</div>` : '';
  const nothing = !cardBlock && !momoBlock ? '<div class="warn">Payment options are being set up. Please WhatsApp us and we will help you pay.</div>' : '';
  return layout('Pay', `
<section class="due">
  <small>Payment for</small>
  <h1>${esc(d.description)}</h1>
  <div class="amount">${esc(d.amount_ugx_text)}</div>
</section>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<h2>How to pay</h2>
${momoBlock}${cardBlock}${nothing}`);
}

function notFoundView() {
  return layout('Link not found', `<section class="due"><h1>This payment link isn't valid</h1><p class="note">Please check the link in your WhatsApp message, or contact makaug.</p></section>`);
}

function send(res, status, html) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).type('html').send(html);
}

function sendPng(res, png, maxAge) {
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', `public, max-age=${maxAge}`);
  res.set('X-Robots-Tag', 'noindex');
  return res.status(200).send(png);
}

// The merchant-code card: the general one, and one with a link's amount.
pages.get('/momo-card.png', (req, res, next) => {
  try {
    return sendPng(res, momoCard.renderMomoCard({ audience: req.query.for === 'person' ? 'person' : 'business' }), 86400);
  } catch (error) {
    return next(error);
  }
});

pages.get('/:code/momo-card.png', async (req, res, next) => {
  try {
    const link = await payLinks.loadLink(db, req.params.code);
    if (!link) return res.status(404).type('text').send('Not found');
    const settings = await billingOps.getSettings(db).catch(() => ({}));
    return sendPng(res, momoCard.renderMomoCard({
      amountUgx: link.amount_ugx,
      description: link.description,
      audience: payLinks.isPersonPayer(link) ? 'person' : 'business',
      settings
    }), 3600);
  } catch (error) {
    return next(error);
  }
});

// --- One tap to confirm (Ronald or Arthur, from the WhatsApp alert) ----------

function confirmFacts(claim) {
  const payer = paymentMatch.smsPayer({ counterparty: claim.sms_counterparty });
  const received = claim.sms_received_at ? new Date(claim.sms_received_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }) : '';
  return `<section class="due">
  <small>MoMo payment</small>
  <div class="amount">${esc(billingOps.ugx(claim.sms_amount_ugx || claim.amount_ugx))}</div>
  <p class="note">From <strong>${esc([payer.name, paymentMatch.prettyPhone(payer.phoneKey)].filter(Boolean).join(' · ') || 'unknown')}</strong>${received ? ` · ${esc(received)}` : ''}</p>
  ${(claim.sms_reference || claim.reference) ? `<p class="note">Transaction ID <span class="code">${esc(claim.sms_reference || claim.reference)}</span></p>` : ''}
  <p class="note">For <strong>${esc(paymentMatch.whoAndWhat(claim))}</strong>${claim.business_name ? ` · they said they paid as <strong>${esc(claim.business_name)}</strong>` : ''}</p>
</section>`;
}

async function confirmContext(token) {
  const t = paymentMatch.readConfirmToken(token);
  if (!t) return { status: 404, html: layout('Link not valid', '<section class="due"><h1>This confirm link is not valid</h1><p class="note">Confirm the payment in King › Sales & Revenue instead.</p></section>') };
  if (t.expired) return { status: 410, html: layout('Link expired', '<section class="due"><h1>This confirm link has expired</h1><p class="note">Links last a week. Confirm it in King › Sales & Revenue, or reply <strong>CONFIRM</strong> and their number on WhatsApp.</p></section>') };
  const confirmer = (await paymentMatch.confirmers(db)).find((c) => c.key === t.confirmerKey);
  if (!confirmer) return { status: 403, html: layout('Not allowed', '<section class="due"><h1>Only the payment confirmers can confirm payments</h1></section>') };
  const claim = await paymentMatch.loadClaim(db, t.claimId);
  if (!claim) return { status: 404, html: notFoundView() };
  return { t, confirmer, claim };
}

function alreadyDecidedView(claim) {
  const when = claim.decided_at ? new Date(claim.decided_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }) : '';
  return layout('Already done', `${confirmFacts(claim)}
<div class="warn">${claim.status === 'confirmed' ? '✓ Already recorded' : `This payment was ${esc(claim.status)}`}${claim.decided_by ? ` by ${esc(String(claim.decided_by).replace(/^whatsapp:/, ''))}` : ''}${when ? ` on ${esc(when)}` : ''}. Nothing more to do.</div>`);
}

pages.get('/confirm/:token', async (req, res, next) => {
  try {
    const ctx = await confirmContext(req.params.token);
    if (ctx.html) return send(res, ctx.status, ctx.html);
    const { claim, confirmer } = ctx;
    if (claim.status !== 'pending') return send(res, 200, alreadyDecidedView(claim));
    if (!claim.sms_id) {
      return send(res, 200, layout('Not yet', `${confirmFacts(claim)}<div class="warn">No MoMo SMS matches this payment yet, so it cannot be confirmed from here. Check the merchant phone, then confirm it in King › Sales & Revenue.</div>`));
    }
    return send(res, 200, layout('Confirm payment', `<p class="note">Hi ${esc(confirmer.name || 'there')} — the money is in the merchant line's SMS. Check it is theirs, then record it.</p>
${confirmFacts(claim)}
<form method="post" action="/pay/confirm/${esc(req.params.token)}" style="margin-top:14px"><button class="btn btn-momo" type="submit">Record this payment</button></form>
<p class="note">Recording it extends their paid-until date, puts anything paused back live, and sends them a receipt on WhatsApp. Not theirs? Leave it, and reject it in King › Sales & Revenue.</p>`));
  } catch (error) {
    return next(error);
  }
});

pages.post('/confirm/:token', async (req, res, next) => {
  try {
    const ctx = await confirmContext(req.params.token);
    if (ctx.html) return send(res, ctx.status, ctx.html);
    if (ctx.claim.status !== 'pending') return send(res, 200, alreadyDecidedView(ctx.claim));
    let done;
    try {
      done = await paymentMatch.confirmByConfirmer(db, { claimId: ctx.claim.id, confirmerKey: ctx.confirmer.key, via: 'link' });
    } catch (error) {
      if (!error.status || error.status >= 500) throw error;
      return send(res, error.status, layout('Not recorded', `${confirmFacts(ctx.claim)}<div class="err">${esc(error.message)}</div>`));
    }
    if (done.already) return send(res, 200, alreadyDecidedView(done.claim));
    const until = done.result?.period_end ? billingOps.prettyDate(done.result.period_end) : '';
    return send(res, 200, layout('Recorded', `<div class="ok"><div class="tick">✓</div><h1>Recorded</h1>
<p>${esc(billingOps.ugx(done.result?.entry?.amount_ugx || ctx.claim.sms_amount_ugx))} · ${esc(paymentMatch.whoAndWhat(ctx.claim))}${until ? ` · paid until ${esc(until)}` : ''}</p></div>
<p class="note" style="text-align:center">${done.after?.receipt_sent ? 'Their receipt has gone to them on WhatsApp.' : 'Recorded. Their receipt could not be sent automatically — please let them know.'}</p>`));
  } catch (error) {
    return next(error);
  }
});

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
    await payLinks.createMomoClaim(db, req.params.code, {
      reference: req.body?.reference,
      phone: req.body?.phone,
      name: req.body?.name,
      businessName: req.body?.business_name
    });
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
