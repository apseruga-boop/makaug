'use strict';

// Staff Preview & edit sends the POA checkbox that was already ticked on a
// listing with no price. That used to throw away the canonical amount they
// typed (the save returned 200 and the field was empty again). A number they
// type is the price. Price on application is the POA period, or the checkbox
// with the price left blank (C20).

function positiveCanonicalPrice(value) {
  if (value == null || value === '') return null;
  const digits = String(value).replace(/[^\d.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 1 ? Math.round(n) : null;
}

function poaFlag(value) {
  return value === true || ['true', '1', 'yes', 'y', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function resolveStaffPriceChoice(patch = {}) {
  const next = { ...patch };
  const period = String(next.price_period || '').trim().toLowerCase();
  const explicitPoaPeriod = period === 'poa';
  const hasPriceKey = Object.prototype.hasOwnProperty.call(next, 'price');
  const numeric = hasPriceKey ? positiveCanonicalPrice(next.price) : null;
  const flagged = Object.prototype.hasOwnProperty.call(next, 'price_on_application') && poaFlag(next.price_on_application);

  if (explicitPoaPeriod || (flagged && numeric == null)) {
    next.price_on_application = true;
    next.price = null;
    next.price_original = null;
    next.price_fx_rate_ugx = null;
    next.price_fx_as_of = null;
    return { patch: next, mode: 'poa' };
  }
  if (numeric != null) {
    next.price = numeric;
    next.price_on_application = false;
    return { patch: next, mode: 'amount' };
  }
  if (Object.prototype.hasOwnProperty.call(next, 'price_on_application')) {
    next.price_on_application = false;
  }
  return { patch: next, mode: 'unchanged' };
}

// Drop a resolved "missing_or_placeholder_price" from the status note. Other
// price-evidence reasons in the same sentence stay.
function priceEvidenceNote(reason, quality) {
  let text = String(reason || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const reasons = new Set(quality?.reasons || []);
  if (reasons.has('missing_or_placeholder_price')) return text;
  if (!/missing_or_placeholder_price/i.test(text)) return text;
  text = text.replace(/missing_or_placeholder_price/gi, '');
  text = text.replace(/Price evidence needs staff review:\s*(?:,\s*)*(?:\.|$)/gi, '');
  text = text
    .replace(/,\s*,/g, ',')
    .replace(/:\s*,/g, ': ')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
  text = text.replace(/Price evidence needs staff review:\s*$/i, '').trim();
  return text.replace(/^[,.\s]+|[,.\s]+$/g, '').trim();
}

module.exports = {
  positiveCanonicalPrice,
  priceEvidenceNote,
  resolveStaffPriceChoice
};
