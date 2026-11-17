'use strict';

/**
 * The Companion's daily list as a CSV: name, phone, what_they_posted, source,
 * with a header row. Tolerates a BOM, quotes, commas and new lines inside
 * quoted fields, CRLF, ; or tab separators, and headers in any order or case.
 * The file is parsed in memory and never stored.
 */
const MAX_ROWS = 2000;
const HEADERS = {
  name: ['name', 'full_name', 'fullname', 'contact', 'contact_name'],
  phone: ['phone', 'number', 'phone_number', 'mobile', 'whatsapp', 'tel'],
  what_they_posted: ['what_they_posted', 'what they posted', 'posted', 'post', 'what_posted', 'notes', 'note'],
  source: ['source', 'list_source', 'where_from', 'where from']
};

function splitCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const sep = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += c;
    } else if (c === '"' && field.trim() === '') { field = ''; quoted = true; }
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
      if (rows.length > MAX_ROWS + 1) break;
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => String(f).trim() !== ''));
}

const norm = (h) => String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Rows → [{ name, phone, what_they_posted, source }] in file order. */
function parseCompanionCsv(text) {
  const rows = splitCsv(text);
  if (!rows.length) return { lines: [], error: 'The file is empty.' };
  const head = rows[0].map(norm);
  const col = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = head.findIndex((h) => names.includes(h) || names.includes(h.replace(/ /g, '_')));
    if (i >= 0) col[key] = i;
  }
  if (col.phone == null) return { lines: [], error: 'No "phone" column. The first row must be: name, phone, what_they_posted, source.' };
  const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const lines = rows.slice(1, MAX_ROWS + 1).map((r) => ({
    name: col.name == null ? '' : clean(r[col.name], 120),
    phone: clean(r[col.phone], 40),
    what_they_posted: col.what_they_posted == null ? '' : clean(r[col.what_they_posted], 500),
    source: col.source == null ? '' : clean(r[col.source], 60)
  }));
  return { lines, error: '' };
}

module.exports = { parseCompanionCsv, splitCsv, MAX_ROWS };
