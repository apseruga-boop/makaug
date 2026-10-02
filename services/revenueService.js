'use strict';

/**
 * Agent subscriptions and the money ledger.
 *
 * Every shilling that comes in or goes out of a makaug account is an entry:
 * who paid, how much, into which account, and the transaction ID printed on
 * the MoMo / Airtel / bank receipt. Three things keep it honest while the
 * money is handled by hand in Uganda:
 *
 *  1. A transaction ID can only be used once per account, so one receipt
 *     cannot be shown for two agents.
 *  2. The MoMo phone can forward its own SMS receipts here (a free Android
 *     SMS-forwarder app pointed at /api/money-sms/inbound). Each entry whose
 *     transaction ID appears in a real SMS is marked verified automatically;
 *     money that arrived by SMS but was never recorded is listed; and the SMS
 *     "new balance" line is checked against what the ledger says it should be.
 *  3. Anything not matched by an SMS or a statement stays "unverified" until a
 *     second person checks it, and every balance check records the difference.
 */

const crypto = require('crypto');

const METHODS = {
  mtn_momo: { label: 'MTN Mobile Money', account: 'mtn_momo' },
  airtel_money: { label: 'Airtel Money', account: 'airtel_money' },
  bank_transfer: { label: 'Bank transfer / deposit (other bank)', account: 'bank' },
  absa_ugx: { label: 'Absa — UGX account', account: 'absa_ugx' },
  absa_usd: { label: 'Absa — USD account', account: 'absa_usd', currency: 'USD' },
  cash: { label: 'Cash', account: 'cash' }
};
const OUT_KINDS = new Set(['withdrawal', 'expense', 'transfer_out', 'refund']);
const IN_KINDS = new Set(['agent_subscription', 'listing_fee', 'other_income', 'transfer_in', 'opening_adjustment']);

function feeConfig() {
  return {
    feeUgx: Math.max(0, Number(process.env.AGENT_MONTHLY_FEE_UGX || 50000) || 50000),
    startDate: String(process.env.AGENT_FEE_START_DATE || '2026-10-05').slice(0, 10)
  };
}

function kampalaDate(date = new Date()) {
  return new Date(date.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  // 31 Jan + 1 month should not roll into March.
  if (dt.getUTCDate() !== d) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

// pg returns DATE columns as a Date at local midnight; turn either form into YYYY-MM-DD.
function isoDay(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

function addDays(isoDate, days) {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Does approving this agent need a payment first? */
function agentFeeRequired(agent = {}, now = new Date()) {
  const { feeUgx, startDate } = feeConfig();
  if (!feeUgx || agent.fee_exempt === true) return false;
  if (kampalaDate(now) < startDate) return false;
  const paidUntil = isoDay(agent.paid_until);
  return !(paidUntil && paidUntil >= kampalaDate(now));
}

function httpError(status, message, details) {
  return Object.assign(new Error(message), { status, details });
}

function cleanText(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseAmount(value) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Turn what an admin typed into a ledger entry, or say exactly what is wrong. */
function normalizeEntry(input = {}, { direction = 'in', kind = 'agent_subscription' } = {}) {
  const errors = [];
  const method = cleanText(input.method, 40).toLowerCase();
  const methodInfo = METHODS[method];
  if (!methodInfo) errors.push('How was it paid? Choose MTN Mobile Money, Airtel Money, bank transfer or cash.');
  const isUsd = methodInfo?.currency === 'USD';
  const amount = parseAmount(input.amount_ugx ?? input.amount);
  if (!isUsd && !(amount > 0)) errors.push('Enter the amount received in UGX.');
  const reference = cleanText(input.reference ?? input.transaction_id ?? input.payment_code, 80).replace(/\s+/g, '');
  if (method && method !== 'cash' && reference.length < 4) {
    errors.push('Enter the transaction ID from the MoMo / Airtel / bank receipt.');
  }
  if (method === 'cash' && !cleanText(input.note, 300) && !input.receipt_url) {
    errors.push('For cash, say who received it and where it is kept (or attach a receipt photo).');
  }
  const accountKey = cleanText(input.account_key, 40) || methodInfo?.account || '';
  let paidAt = input.paid_at ? new Date(input.paid_at) : new Date();
  if (Number.isNaN(paidAt.getTime())) paidAt = new Date();
  if (paidAt.getTime() > Date.now() + 36 * 3600 * 1000) errors.push('The payment date is in the future.');
  // Money into the Absa USD account is kept in dollars and valued in UGX at the rate given.
  const currency = methodInfo?.currency || 'UGX';
  let amountUgx = amount;
  let fxRate = null;
  let usdAmount = null;
  if (currency === 'USD') {
    // A form that has a dollar field must fill it in; only API callers without one may send `amount` in dollars.
    const hasUsdField = input.amount_original !== undefined || input.amount_usd !== undefined;
    const usdCandidates = hasUsdField ? [input.amount_original, input.amount_usd] : [input.amount];
    usdAmount = usdCandidates.map((v) => Number(String(v ?? '').replace(/[^\d.]/g, ''))).find((v) => v > 0) || 0;
    const usd = usdAmount;
    fxRate = Number(input.fx_rate_ugx || process.env.USD_UGX_RATE || 3700);
    if (!(usd > 0)) errors.push('Enter the amount in US dollars.');
    if (!(fxRate > 1000 && fxRate < 10000)) errors.push('Enter the UGX-per-dollar rate used (e.g. 3700).');
    amountUgx = Math.round(usd * fxRate);
  }
  if (errors.length) throw httpError(400, errors[0], errors);
  return {
    direction,
    kind,
    currency,
    amount_original: currency === 'USD' ? usdAmount : null,
    fx_rate_ugx: fxRate,
    amount_ugx: amountUgx,
    method,
    account_key: accountKey,
    reference: reference || null,
    paid_at: paidAt.toISOString(),
    payer_name: cleanText(input.payer_name, 120) || null,
    payer_phone: cleanText(input.payer_phone, 40) || null,
    note: cleanText(input.note, 500) || null,
    receipt_url: cleanText(input.receipt_url, 2000) || null
  };
}

/** A receipt photo arrives as a data URL; store it and keep only its link. */
async function prepareReceipt(input = {}) {
  const raw = String(input.receipt_url || '').trim();
  if (!raw.startsWith('data:')) return input;
  const { prepareMediaUrlForStorage } = require('./cloudMediaStorageService');
  const url = await prepareMediaUrlForStorage(raw, {
    keyPrefix: `revenue-receipts/${crypto.randomUUID()}`,
    filename: 'receipt.jpg',
    label: 'payment receipt',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    maxBytes: 6_000_000
  });
  if (!url || url.startsWith('data:')) throw httpError(400, 'The receipt photo could not be stored. Try a smaller photo, or record the payment without it.');
  return { ...input, receipt_url: url };
}

async function insertEntry(db, entry, actor) {
  try {
    const result = await db.query(
      `INSERT INTO revenue_entries
         (direction, kind, agent_id, amount_ugx, account_key, method, reference, paid_at, period_start, period_end,
          payer_name, payer_phone, note, receipt_url, recorded_by, currency, amount_original, fx_rate_ugx, property_id)
       VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8::timestamptz,$9::date,$10::date,$11,$12,$13,$14,$15,$16,$17,$18,$19::uuid)
       RETURNING *`,
      [entry.direction, entry.kind, entry.agent_id || null, entry.amount_ugx, entry.account_key, entry.method,
        entry.reference, entry.paid_at, entry.period_start || null, entry.period_end || null,
        entry.payer_name, entry.payer_phone, entry.note, entry.receipt_url, actor || 'admin',
        entry.currency || 'UGX', entry.amount_original ?? null, entry.fx_rate_ugx ?? null, entry.property_id || null]
    );
    return result.rows[0];
  } catch (error) {
    if (String(error.code) === '23505') {
      const prior = (await db.query(
        `SELECT e.paid_at, e.amount_ugx, a.full_name
           FROM revenue_entries e LEFT JOIN agents a ON a.id = e.agent_id
          WHERE e.account_key = $1 AND LOWER(e.reference) = LOWER($2) AND e.voided_at IS NULL
          LIMIT 1`,
        [entry.account_key, entry.reference]
      )).rows[0];
      throw httpError(409, `Transaction ID ${entry.reference} has already been recorded${prior ? ` (UGX ${Number(prior.amount_ugx).toLocaleString('en-US')}${prior.full_name ? ` for ${prior.full_name}` : ''}, ${new Date(prior.paid_at).toISOString().slice(0, 10)})` : ''}. One receipt can only be used once.`);
    }
    throw error;
  }
}

/** Mark an entry verified if the wallet's own SMS shows the same transaction. */
async function matchEntryToSms(db, entry) {
  if (!entry?.reference) return entry;
  const sms = (await db.query(
    `SELECT id, amount_ugx FROM money_sms_inbox
      WHERE LOWER(reference) = LOWER($1) AND matched_entry_id IS NULL
      ORDER BY received_at DESC LIMIT 1`,
    [entry.reference]
  )).rows[0];
  if (!sms) return entry;
  const amountOk = !sms.amount_ugx || Number(sms.amount_ugx) === Number(entry.amount_ugx);
  const updated = (await db.query(
    `UPDATE revenue_entries
        SET verified_status = $2, verified_by = 'sms', verified_at = NOW(), verification_source = 'sms_match', sms_id = $3
      WHERE id = $1 RETURNING *`,
    [entry.id, amountOk ? 'verified' : 'disputed', sms.id]
  )).rows[0];
  await db.query('UPDATE money_sms_inbox SET matched_entry_id = $2 WHERE id = $1', [sms.id, entry.id]);
  return updated || entry;
}

/**
 * Record an agent's subscription payment and move their paid-until date on.
 * UGX 50,000 buys one month; 150,000 buys three.
 */
async function recordAgentPayment(db, { agent, payment: rawPayment, actor }) {
  const { feeUgx } = feeConfig();
  normalizeEntry(rawPayment); // say what is missing before storing any photo
  const payment = await prepareReceipt(rawPayment);
  const entry = normalizeEntry({
    ...payment,
    payer_name: payment.payer_name || agent.full_name,
    payer_phone: payment.payer_phone || agent.whatsapp || agent.phone
  });
  const months = feeUgx ? Math.floor(entry.amount_ugx / feeUgx) : 1;
  if (feeUgx && months < 1) {
    throw httpError(400, `The monthly fee is UGX ${feeUgx.toLocaleString('en-US')}; UGX ${entry.amount_ugx.toLocaleString('en-US')} is less than one month.`);
  }
  const today = kampalaDate();
  const current = isoDay(agent.paid_until);
  const periodStart = current && current >= today ? addDays(current, 1) : today;
  const periodEnd = addDays(addMonths(periodStart, months), -1);
  const row = await insertEntry(db, { ...entry, kind: 'agent_subscription', agent_id: agent.id, period_start: periodStart, period_end: periodEnd }, actor);
  await db.query(
    `UPDATE agents SET paid_until = $2::date, billing_plan = 'agent_monthly', monthly_fee_ugx = $3, updated_at = NOW() WHERE id = $1`,
    [agent.id, periodEnd, feeUgx]
  );
  const matched = await matchEntryToSms(db, row);
  return { entry: matched, months, period_start: periodStart, period_end: periodEnd };
}

async function recordEntry(db, input, actor) {
  const direction = input.direction === 'out' ? 'out' : 'in';
  const kind = cleanText(input.kind, 40) || (direction === 'out' ? 'expense' : 'other_income');
  if (direction === 'out' && !OUT_KINDS.has(kind)) throw httpError(400, 'Money out must be a withdrawal, expense, transfer out or refund.');
  if (direction === 'in' && !IN_KINDS.has(kind)) throw httpError(400, 'Unknown kind of income.');
  normalizeEntry(input, { direction, kind });
  const entry = normalizeEntry(await prepareReceipt(input), { direction, kind });
  if (direction === 'out' && !entry.note) throw httpError(400, 'Say what the money was for, and who took it.');
  const row = await insertEntry(db, { ...entry, agent_id: input.agent_id || null }, actor);
  return matchEntryToSms(db, row);
}

// --- Money SMS --------------------------------------------------------------

function smsAmount(text) {
  const m = text.match(/(?:UGX|Ush|Shs?)\s*([\d,]+(?:\.\d+)?)/i) || text.match(/([\d,]{3,}(?:\.\d+)?)\s*(?:UGX|Ush|Shs?)/i);
  return m ? Math.round(Number(m[1].replace(/,/g, ''))) : null;
}

/**
 * Read an MTN MoMo / Airtel Money SMS. Formats change, so this looks for the
 * parts rather than a whole template: the amount, the transaction ID, the
 * other party and the new balance.
 */
function parseMoneySms(body = '', sender = '') {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const from = `${sender} ${text}`.toLowerCase();
  const accountKey = /airtel/.test(from) ? 'airtel_money' : (/mtn|momo|mobile\s?money|y'ello/.test(from) ? 'mtn_momo' : null);
  const direction = /\b(?:you have received|received|deposit(?:ed)?|credited|payment (?:of|from)|has sent you)\b/.test(lower)
    ? 'in'
    : (/\b(?:you have sent|sent|withdr(?:awn|aw)|paid to|payment to|debited|transferred)\b/.test(lower) ? 'out' : 'unknown');
  const amountPart = text.split(/new balance|bal(?:ance)?[:\s]/i)[0];
  const amount = smsAmount(amountPart);
  const refMatch = text.match(/(?:Financial Transaction Id|Transaction Id|Trans(?:action)?\.?\s*ID|Txn\s*ID|TID|Ref(?:erence)?(?:\s*No)?)[\s:.#]*([A-Z0-9][A-Z0-9.\-]{3,})/i);
  const balMatch = text.match(/(?:new balance|bal(?:ance)?)\s*(?:is|:)?\s*(?:UGX|Ush|Shs?)?\s*([\d,]+(?:\.\d+)?)/i);
  let partyMatch = text.match(/\bfrom\s+([A-Za-z][A-Za-z .'-]{2,60}?)(?:\s*\(|,|\s+on\b|\s+\d)/i)
    || text.match(/\bto\s+([A-Za-z][A-Za-z .'-]{2,60}?)(?:\s*\(|,|\s+on\b|\s+\d)/i);
  if (partyMatch && /^(?:your|you|the)\b/i.test(partyMatch[1])) partyMatch = null;
  if (!partyMatch) {
    // Airtel: "from 256752123456, JOHN DOE."
    const afterPhone = text.match(/\b(?:256|0)7\d{8}\s*,\s*([A-Za-z][A-Za-z .'-]{2,60}?)\s*[.,]/);
    if (afterPhone) partyMatch = afterPhone;
  }
  const phoneMatch = text.match(/\b(?:256|0)7\d{8}\b/);
  return {
    account_key: accountKey,
    direction,
    amount_ugx: amount,
    reference: refMatch ? refMatch[1].replace(/[.\-]+$/, '') : null,
    balance_ugx: balMatch ? Math.round(Number(balMatch[1].replace(/,/g, ''))) : null,
    counterparty: [partyMatch ? partyMatch[1].trim() : '', phoneMatch ? phoneMatch[0] : ''].filter(Boolean).join(' ') || null
  };
}

async function expectedBalance(db, accountKey) {
  const row = (await db.query(
    `SELECT a.opening_balance,
            COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount_ugx ELSE -e.amount_ugx END)
              FILTER (WHERE e.id IS NOT NULL), 0) AS movement
       FROM money_accounts a
       LEFT JOIN revenue_entries e
         ON e.account_key = a.key AND e.voided_at IS NULL AND e.paid_at >= a.opening_date::timestamptz
      WHERE a.key = $1
      GROUP BY a.opening_balance`,
    [accountKey]
  )).rows[0];
  return row ? Number(row.opening_balance) + Number(row.movement) : 0;
}

async function recordBalanceCheck(db, { accountKey, actual, source = 'manual', note = null, evidenceUrl = null, actor = 'admin' }) {
  const expected = await expectedBalance(db, accountKey);
  const row = (await db.query(
    `INSERT INTO money_balance_checks (account_key, actual_balance, expected_balance, difference, source, note, evidence_url, checked_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [accountKey, actual, expected, actual - expected, source, note, evidenceUrl, actor]
  )).rows[0];
  return row;
}

async function ingestMoneySms(db, { body, sender = '', receivedAt = null, accountKey = null, raw = {} }) {
  const text = String(body || '').trim();
  if (!text) throw httpError(400, 'SMS body is required');
  const parsed = parseMoneySms(text, sender);
  const account = accountKey || parsed.account_key;
  const sha = crypto.createHash('sha256').update(`${sender}|${text}`).digest('hex');
  const inserted = (await db.query(
    `INSERT INTO money_sms_inbox (received_at, sender, body, body_sha256, account_key, direction, amount_ugx, reference, counterparty, balance_ugx, raw)
     VALUES (COALESCE($1::timestamptz, NOW()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     ON CONFLICT (body_sha256) DO NOTHING
     RETURNING *`,
    [receivedAt, sender || null, text, sha, account, parsed.direction, parsed.amount_ugx, parsed.reference, parsed.counterparty, parsed.balance_ugx, JSON.stringify(raw || {})]
  )).rows[0];
  if (!inserted) return { duplicate: true };

  let matched = null;
  if (parsed.reference) {
    const entry = (await db.query(
      `SELECT * FROM revenue_entries WHERE LOWER(reference) = LOWER($1) AND voided_at IS NULL ORDER BY recorded_at DESC LIMIT 1`,
      [parsed.reference]
    )).rows[0];
    if (entry) {
      const amountOk = !parsed.amount_ugx || Number(parsed.amount_ugx) === Number(entry.amount_ugx);
      matched = (await db.query(
        `UPDATE revenue_entries
            SET verified_status = $2, verified_by = 'sms', verified_at = NOW(), verification_source = 'sms_match', sms_id = $3
          WHERE id = $1 RETURNING *`,
        [entry.id, amountOk ? 'verified' : 'disputed', inserted.id]
      )).rows[0];
      await db.query('UPDATE money_sms_inbox SET matched_entry_id = $2 WHERE id = $1', [inserted.id, entry.id]);
    }
  }
  let claimsMatched = [];
  try {
    claimsMatched = await require('./billingOpsService').matchSmsToClaims(db, inserted) || [];
  } catch (_ignored) { /* claims are a second chance, not the main path */ }
  let balanceCheck = null;
  if (account && parsed.balance_ugx != null) {
    const exists = (await db.query('SELECT 1 FROM money_accounts WHERE key = $1', [account])).rows[0];
    if (exists) balanceCheck = await recordBalanceCheck(db, { accountKey: account, actual: parsed.balance_ugx, source: 'sms', note: 'Balance line of a forwarded money SMS', actor: 'sms' });
  }
  return { sms: inserted, parsed, matched, balanceCheck, claimsMatched };
}

// --- Bank / wallet statements ----------------------------------------------

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function statementNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw) || /\bDR\b/i.test(raw);
  const n = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || raw.replace(/[^\d]/g, '') === '') return null;
  return negative ? -n : n;
}

function statementDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Read a statement exported as CSV (Absa, other banks, MoMo statements): finds
 * the date, description, reference, money in / out (or one signed amount) and
 * balance columns by their names.
 */
function parseStatementCsv(text = '') {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  const headerIndex = lines.findIndex((l) => /date/i.test(l) && /(amount|credit|debit|money in|deposit|withdraw)/i.test(l));
  if (headerIndex < 0) throw httpError(400, 'Could not find the header row (it needs a Date column and Amount or Credit/Debit columns).');
  const header = splitCsvLine(lines[headerIndex]).map((h) => h.toLowerCase());
  const col = (re) => header.findIndex((h) => re.test(h));
  const c = {
    date: col(/^(?:transaction |trans |value |posting |)date|^date/),
    desc: col(/desc|narrat|detail|particular|remark|memo/),
    ref: col(/ref|cheque|transaction id|trans id|txn/),
    credit: col(/credit|money in|deposit|paid in|^in$/),
    debit: col(/debit|money out|withdraw|paid out|^out$/),
    amount: col(/^amount|amount$/),
    balance: col(/balance/)
  };
  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = splitCsvLine(line);
    const date = statementDate(cells[c.date]);
    let amount = null;
    if (c.credit >= 0 || c.debit >= 0) {
      const credit = c.credit >= 0 ? statementNumber(cells[c.credit]) : null;
      const debit = c.debit >= 0 ? statementNumber(cells[c.debit]) : null;
      if (credit) amount = Math.abs(credit);
      else if (debit) amount = -Math.abs(debit);
    }
    if (amount == null && c.amount >= 0) amount = statementNumber(cells[c.amount]);
    if (!date || !amount) continue;
    rows.push({
      line_date: date,
      description: c.desc >= 0 ? cells[c.desc] || '' : '',
      reference: c.ref >= 0 ? cells[c.ref] || '' : '',
      amount,
      balance: c.balance >= 0 ? statementNumber(cells[c.balance]) : null,
      raw: line
    });
  }
  if (!rows.length) throw httpError(400, 'No transactions found under the header row.');
  return rows;
}

/** Load a statement, match it to the ledger, and report what does not agree. */
async function importStatement(db, { accountKey, csv, actor = 'admin' }) {
  const account = (await db.query('SELECT key, currency FROM money_accounts WHERE key = $1', [accountKey])).rows[0];
  if (!account) throw httpError(400, 'Choose the account this statement is for');
  const rows = parseStatementCsv(csv);
  const batchId = crypto.randomUUID();
  let inserted = 0;
  for (const r of rows) {
    const sha = crypto.createHash('sha256').update(`${accountKey}|${r.raw}`).digest('hex');
    const res = await db.query(
      `INSERT INTO bank_statement_lines (account_key, uploaded_by, batch_id, line_date, description, reference, amount, balance, line_sha256)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9) ON CONFLICT (line_sha256) DO NOTHING RETURNING id`,
      [accountKey, actor, batchId, r.line_date, r.description.slice(0, 500), r.reference.slice(0, 120), r.amount, r.balance, sha]
    );
    if (res.rows[0]) inserted += 1;
  }
  // Match every unmatched line on this account to an unmatched ledger entry.
  const lines = (await db.query(
    `SELECT * FROM bank_statement_lines WHERE account_key = $1 AND matched_entry_id IS NULL ORDER BY line_date`,
    [accountKey]
  )).rows;
  let matched = 0;
  for (const line of lines) {
    const amountCol = account.currency === 'USD' ? 'COALESCE(e.amount_original, e.amount_ugx)' : 'e.amount_ugx';
    const direction = Number(line.amount) >= 0 ? 'in' : 'out';
    const candidates = (await db.query(
      `SELECT e.id, e.reference FROM revenue_entries e
        WHERE e.account_key = $1 AND e.voided_at IS NULL AND e.statement_line_id IS NULL AND e.direction = $2
          AND ${amountCol} = $3::numeric
          AND e.paid_at BETWEEN ($4::date - INTERVAL '5 days') AND ($4::date + INTERVAL '6 days')`,
      [accountKey, direction, Math.abs(Number(line.amount)), line.line_date]
    )).rows;
    const text = `${line.description} ${line.reference}`.toLowerCase();
    const byRef = candidates.find((c) => c.reference && text.includes(String(c.reference).toLowerCase()));
    const pick = byRef || (candidates.length === 1 ? candidates[0] : null);
    if (!pick) continue;
    await db.query('UPDATE bank_statement_lines SET matched_entry_id = $2 WHERE id = $1', [line.id, pick.id]);
    await db.query(
      `UPDATE revenue_entries SET statement_line_id = $2,
              verified_status = CASE WHEN verified_status = 'disputed' THEN verified_status ELSE 'verified' END,
              verified_by = COALESCE(verified_by, 'statement'), verified_at = COALESCE(verified_at, NOW()),
              verification_source = CONCAT_WS('+', NULLIF(verification_source, ''), 'statement')
        WHERE id = $1`,
      [pick.id, line.id]
    );
    matched += 1;
  }
  const last = rows.filter((r) => r.balance != null).pop();
  let balanceCheck = null;
  if (last && account.currency === 'UGX') {
    balanceCheck = await recordBalanceCheck(db, { accountKey, actual: Math.round(last.balance), source: 'statement', note: `Closing balance of statement uploaded ${new Date().toISOString().slice(0, 10)}`, actor });
  }
  const unmatchedLines = (await db.query(
    `SELECT line_date::text AS line_date, description, reference, amount FROM bank_statement_lines
      WHERE account_key = $1 AND matched_entry_id IS NULL ORDER BY line_date DESC LIMIT 100`, [accountKey])).rows;
  const unmatchedEntries = (await db.query(
    `SELECT id, paid_at, amount_ugx, amount_original, reference, payer_name FROM revenue_entries
      WHERE account_key = $1 AND voided_at IS NULL AND statement_line_id IS NULL
        AND paid_at <= (SELECT MAX(line_date) FROM bank_statement_lines WHERE account_key = $1)
      ORDER BY paid_at DESC LIMIT 100`, [accountKey])).rows;
  return { lines_read: rows.length, lines_new: inserted, matched, balance_check: balanceCheck, unmatched_lines: unmatchedLines, unmatched_entries: unmatchedEntries };
}

// --- Reporting --------------------------------------------------------------

async function revenueSummary(db) {
  const { feeUgx, startDate } = feeConfig();
  const today = kampalaDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [accounts, month, unverified, agents, unmatchedSms, recent] = await Promise.all([
    db.query(
      `SELECT a.key, a.name, a.kind, a.number_hint, a.opening_balance, a.opening_date::text AS opening_date, a.currency,
              COALESCE(SUM(e.amount_original) FILTER (WHERE e.direction = 'in'), 0)::numeric AS usd_in,
              COALESCE(SUM(e.amount_original) FILTER (WHERE e.direction = 'out'), 0)::numeric AS usd_out,
              COALESCE(SUM(e.amount_ugx) FILTER (WHERE e.direction = 'in'), 0)::bigint AS money_in,
              COALESCE(SUM(e.amount_ugx) FILTER (WHERE e.direction = 'out'), 0)::bigint AS money_out,
              (SELECT row_to_json(c) FROM (
                 SELECT checked_at, actual_balance, expected_balance, difference, source, checked_by
                   FROM money_balance_checks WHERE account_key = a.key ORDER BY checked_at DESC LIMIT 1) c) AS last_check
         FROM money_accounts a
         LEFT JOIN revenue_entries e ON e.account_key = a.key AND e.voided_at IS NULL AND e.paid_at >= a.opening_date::timestamptz
        WHERE a.active
        GROUP BY a.key ORDER BY a.key`
    ),
    db.query(
      `SELECT COALESCE(SUM(amount_ugx) FILTER (WHERE direction = 'in'), 0)::bigint AS money_in,
              COALESCE(SUM(amount_ugx) FILTER (WHERE direction = 'out'), 0)::bigint AS money_out,
              COALESCE(SUM(amount_ugx) FILTER (WHERE direction = 'in' AND kind = 'agent_subscription'), 0)::bigint AS subscriptions,
              COALESCE(SUM(amount_ugx) FILTER (WHERE direction = 'in' AND kind = 'listing_fee'), 0)::bigint AS listing_fees,
              COUNT(*) FILTER (WHERE direction = 'in' AND kind = 'agent_subscription')::int AS subscription_payments
         FROM revenue_entries WHERE voided_at IS NULL AND paid_at >= $1::date`,
      [monthStart]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_ugx), 0)::bigint AS amount
         FROM revenue_entries WHERE voided_at IS NULL AND verified_status <> 'verified'`
    ),
    db.query(
      `SELECT id, full_name, greeting_name, company_name, whatsapp, phone, status, approved_at, paid_until, fee_exempt, monthly_fee_ugx,
              billing_reminder_log, billing_suspended_at
         FROM agents
        WHERE (status = 'approved' OR billing_suspended_at IS NOT NULL) AND removed_at IS NULL
        ORDER BY paid_until NULLS FIRST, full_name`
    ),
    db.query(
      `SELECT id, received_at, sender, account_key, direction, amount_ugx, reference, counterparty, balance_ugx, body
         FROM money_sms_inbox
        WHERE matched_entry_id IS NULL AND direction <> 'unknown'
        ORDER BY received_at DESC LIMIT 50`
    ),
    db.query(
      `SELECT e.*, a.full_name AS agent_name
         FROM revenue_entries e LEFT JOIN agents a ON a.id = e.agent_id
        ORDER BY e.paid_at DESC, e.recorded_at DESC LIMIT 200`
    )
  ]);
  const billing = agents.rows.map((a) => {
    const paidUntil = isoDay(a.paid_until);
    let state;
    if (a.billing_suspended_at) state = 'taken_down';
    else if (a.fee_exempt) state = 'exempt';
    else if (!paidUntil) state = 'never_paid';
    else if (paidUntil < today) state = 'overdue';
    else if (paidUntil <= addDays(today, 5)) state = 'due_soon';
    else state = 'paid';
    const daysOver = paidUntil && paidUntil < today ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${paidUntil}T00:00:00Z`)) / 86400000) : 0;
    const log = a.billing_reminder_log || {};
    const lastOf = (kind) => Object.entries(log).filter(([k]) => k.startsWith(`${kind}:${paidUntil || 'none'}`)).map(([, v]) => v?.at).sort().pop() || null;
    return {
      ...a,
      paid_until: paidUntil || null,
      billing_state: state,
      days_overdue: daysOver,
      last_reminder_at: lastOf('reminder') || lastOf('due_today') || lastOf('pre_due'),
      final_reminder_at: lastOf('final_reminder')
    };
  });
  const paying = billing.filter((a) => ['paid', 'due_soon'].includes(a.billing_state));
  return {
    fee_ugx: feeUgx,
    fee_start_date: startDate,
    today,
    month: month.rows[0],
    mrr_ugx: paying.reduce((sum, a) => sum + Number(a.monthly_fee_ugx || feeUgx), 0),
    paying_agents: paying.length,
    overdue_agents: billing.filter((a) => ['overdue', 'never_paid', 'taken_down'].includes(a.billing_state)).length,
    unverified: unverified.rows[0],
    accounts: accounts.rows.map((a) => ({
      ...a,
      expected_balance: Number(a.opening_balance) + Number(a.money_in) - Number(a.money_out)
    })),
    billing,
    unrecorded_sms: unmatchedSms.rows.filter((s) => s.direction === 'in'),
    unrecorded_sms_out: unmatchedSms.rows.filter((s) => s.direction === 'out'),
    entries: recent.rows
  };
}

function csvCell(value) {
  const s = value == null ? '' : (value instanceof Date ? value.toISOString() : String(value));
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

async function entriesCsv(db) {
  const rows = (await db.query(
    `SELECT e.paid_at, e.direction, e.kind, a.full_name AS agent, e.amount_ugx, e.account_key, e.method, e.reference,
            e.period_start, e.period_end, e.payer_name, e.payer_phone, e.note, e.recorded_by, e.recorded_at,
            e.verified_status, e.verification_source, e.verified_by, e.verified_at, e.voided_at, e.void_reason
       FROM revenue_entries e LEFT JOIN agents a ON a.id = e.agent_id
      ORDER BY e.paid_at`
  )).rows;
  const header = ['paid_at', 'direction', 'kind', 'agent', 'amount_ugx', 'account', 'method', 'transaction_id', 'period_start', 'period_end',
    'payer_name', 'payer_phone', 'note', 'recorded_by', 'recorded_at', 'verified_status', 'verified_how', 'verified_by', 'verified_at', 'voided_at', 'void_reason'];
  return [header.map(csvCell).join(','), ...rows.map((r) => [r.paid_at, r.direction, r.kind, r.agent, r.amount_ugx, r.account_key, r.method, r.reference,
    r.period_start, r.period_end, r.payer_name, r.payer_phone, r.note, r.recorded_by, r.recorded_at, r.verified_status, r.verification_source,
    r.verified_by, r.verified_at, r.voided_at, r.void_reason].map(csvCell).join(','))].join('\n');
}

module.exports = {
  METHODS,
  isoDay,
  feeConfig,
  kampalaDate,
  addMonths,
  agentFeeRequired,
  normalizeEntry,
  recordAgentPayment,
  recordEntry,
  parseMoneySms,
  ingestMoneySms,
  expectedBalance,
  recordBalanceCheck,
  revenueSummary,
  entriesCsv,
  parseStatementCsv,
  importStatement,
  httpError
};
