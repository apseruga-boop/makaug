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

const POA_TEXT = /\b(?:price\s*)?(?:upon\s+application|on\s+request|poa)\b/i;

function extraObject(record = {}) {
  const extra = record.extra_fields;
  return extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
}

function poaHistoryText(value) {
  return POA_TEXT.test(String(value || '').replace(/_/g, ' '));
}

// A numeric price staff already saved (column and extra POA flags explicitly
// false) is the price. Leftover harvest labels are history, not a second price.
function staffConfirmedNumericPrice(record = {}) {
  const extra = extraObject(record);
  const price = Number(record.price);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (record.price_on_application === true || record.priceOnApplication === true) return false;
  if (extra.price_on_application === true || extra.price_upon_application === true) return false;
  return record.price_on_application === false
    && extra.price_on_application === false
    && extra.price_upon_application === false;
}

// Resets the live price_status / price_label. source_price_label and
// source_price_rejection_reason stay as harvest history.
function staffPriceExtraPatch({ mode = 'unchanged', existing = {}, existingExtra = {} } = {}) {
  if (mode === 'poa') {
    return {
      price_on_application: true,
      price_upon_application: true
    };
  }
  const leftoverPoaLabel = poaHistoryText(existingExtra.price_status)
    || String(existingExtra.price_status || '') === 'price_upon_application'
    || poaHistoryText(existingExtra.price_label);
  const alreadyConfirmed = staffConfirmedNumericPrice({ ...existing, extra_fields: existingExtra });
  if (mode !== 'amount' && !(alreadyConfirmed && leftoverPoaLabel)) return null;
  const patch = {
    price_status: 'published_price_or_guide_price',
    price_label: null
  };
  if (mode === 'amount') {
    patch.price_on_application = false;
    patch.price_upon_application = false;
    patch.price_review = null;
  }
  return patch;
}

function resolveStaffPriceChoice(patch = {}, existing = {}) {
  const next = { ...patch };
  const period = String(next.price_period || '').trim().toLowerCase();
  const explicitPoaPeriod = period === 'poa';
  const hasPriceKey = Object.prototype.hasOwnProperty.call(next, 'price');
  const numeric = hasPriceKey ? positiveCanonicalPrice(next.price) : null;
  const hasPoaKey = Object.prototype.hasOwnProperty.call(next, 'price_on_application');
  const flagged = hasPoaKey && poaFlag(next.price_on_application);
  const explicitUntick = hasPoaKey && !flagged && !explicitPoaPeriod;

  if (explicitPoaPeriod || (flagged && numeric == null && !explicitUntick)) {
    next.price_on_application = true;
    next.price = null;
    next.price_original = null;
    next.price_fx_rate_ugx = null;
    next.price_fx_as_of = null;
    return { patch: next, mode: 'poa' };
  }
  // Unticking Price on application on a row that already has a number must
  // clear the column and the extra POA flags. A blank price in this save is a
  // clear, so the stored number is kept only when the price key was omitted.
  const stored = !hasPriceKey ? positiveCanonicalPrice(existing.price) : null;
  const amount = numeric != null ? numeric : (explicitUntick ? stored : null);
  if (amount != null) {
    next.price = amount;
    next.price_on_application = false;
    return { patch: next, mode: 'amount' };
  }
  if (hasPoaKey) next.price_on_application = false;
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
  resolveStaffPriceChoice,
  staffConfirmedNumericPrice,
  staffPriceExtraPatch
};
