'use strict';

// One Uganda mobile number, whatever way it was typed.
// 0750… , 256750… and +256750… are the same line. Stored form is +256 and nine digits.

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneKey9(value) {
  const d = digits(value);
  return d.length >= 9 ? d.slice(-9) : '';
}

function canonicalUgPhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const d = digits(raw);
  if (/^0\d{9}$/.test(d)) return `+256${d.slice(1)}`;
  if (/^256\d{9}$/.test(d)) return `+${d}`;
  if (/^7\d{8}$/.test(d)) return `+256${d}`;
  const compact = raw.replace(/[\s()-]/g, '');
  if (/^\+\d{10,15}$/.test(compact)) return compact;
  return raw;
}

// Public logs and reports show +256•••959, never the full number.
function maskPhoneLast3(value) {
  const d = digits(value);
  if (d.length < 3) return '';
  return `+256•••${d.slice(-3)}`;
}

module.exports = { digits, phoneKey9, canonicalUgPhone, maskPhoneLast3 };
