'use strict';

// Feature flags for the Short Term stays section.
//
// Everything short term is dark by default. SHORT_TERM_ENABLED=true is the
// single switch that turns the section on; setting it back to false is the
// entire rollback procedure. No migration is reversed, no data is deleted, and
// no existing makaug route changes behaviour either way.

function envFlagEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value == null ? '' : value).trim());
}

function shortTermEnabled(env = process.env) {
  return envFlagEnabled(env.SHORT_TERM_ENABLED);
}

// Hosts can submit a listing themselves. Kept separate from the read-only
// section so the public pages can go live before intake is opened up.
function shortTermIntakeEnabled(env = process.env) {
  if (!shortTermEnabled(env)) return false;
  if (env.SHORT_TERM_INTAKE_ENABLED == null || String(env.SHORT_TERM_INTAKE_ENABLED).trim() === '') {
    return true;
  }
  return envFlagEnabled(env.SHORT_TERM_INTAKE_ENABLED);
}

// Guest reviews and scores under privately listed places.
function shortTermReviewsEnabled(env = process.env) {
  if (!shortTermEnabled(env)) return false;
  if (env.SHORT_TERM_REVIEWS_ENABLED == null || String(env.SHORT_TERM_REVIEWS_ENABLED).trim() === '') {
    return true;
  }
  return envFlagEnabled(env.SHORT_TERM_REVIEWS_ENABLED);
}

// The AFCON 2027 countdown banner. One of several things that can run in the
// Short Term hero, so it gets its own switch and its own date.
function shortTermCountdownEnabled(env = process.env) {
  if (!shortTermEnabled(env)) return false;
  return !/^(0|false|no|off)$/i.test(String(env.SHORT_TERM_COUNTDOWN_ENABLED ?? 'true').trim());
}

const SHORT_TERM_NODE_ATTRIBUTE = 'data-short-term-entry';

// Same approach as applyHarvestPublicSubmissionVisibility: the markup ships in
// index.html, and the server hides it until the flag is on. That keeps one
// source of truth for the nav and avoids a second, drifting copy of it.
function applyShortTermVisibility(html, env = process.env) {
  const source = String(html || '');
  if (shortTermEnabled(env)) return source;
  return source.replace(
    /(<(?:a|button|div|section|li)\b(?=[^>]*\bdata-short-term-entry\b)[^>]*)(>)/gi,
    '$1 hidden aria-hidden="true" style="display:none!important"$2'
  );
}

// AFCON 2027 kicks off on 19 June 2027 - CAF confirmed 19 June to 17 July for
// the Pamoja tournament across Kenya, Tanzania and Uganda. Kick-off is 16:00
// East Africa Time, which is 13:00 UTC.
//
// SHORT_TERM_COUNTDOWN_TARGET overrides this, so if CAF moves the date it is a
// config change rather than a deploy. Setting the variable to an unparseable
// value hides the banner rather than showing something wrong.
const {
  publicConfig: travelpayoutsPublicConfig,
  extrasConfig: travelpayoutsExtrasConfig
} = require('../services/travelpayoutsAffiliate');

const AFCON_2027_KICKOFF = '2027-06-19T13:00:00.000Z';

function publicWhatsappDigits(env = process.env) {
  const raw = String(env.MAKAUG_WHATSAPP_NUMBER || env.WHATSAPP_BUSINESS_NUMBER || '256780863394');
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `256${digits.slice(1)}`;
  if (digits.length === 9) digits = `256${digits}`;
  return digits || '256780863394';
}

function shortTermCountdownTarget(env = process.env) {
  const raw = String(env.SHORT_TERM_COUNTDOWN_TARGET || '').trim();
  if (!raw) return AFCON_2027_KICKOFF;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Injected into every public page so the client app knows whether the section
// is live before the visitor navigates to it. With the flag off nothing is
// injected and the client script refuses to boot.
function injectShortTermRuntimeConfig(html, env = process.env) {
  const source = String(html || '');
  if (!shortTermEnabled(env)) return source;
  const travelpayouts = travelpayoutsPublicConfig(env);
  const extras = travelpayoutsExtrasConfig(env);
  const config = {
    enabled: true,
    countdown: shortTermCountdownEnabled(env) ? shortTermCountdownTarget(env) : null,
    countdownLabel: String(env.SHORT_TERM_COUNTDOWN_LABEL || 'AFCON 2027').trim(),
    whatsappNumber: publicWhatsappDigits(env),
    // The Drive script URL stays out of this payload. driveEnabled follows
    // TRAVELPAYOUTS_DRIVE_ENABLED (default off). driveProjectId is
    // TRAVELPAYOUTS_DRIVE_PROJECT_ID, or 581854. short-term.js loads the script
    // only on /short-term when driveEnabled is on. Other public pages get it
    // from injectTravelpayoutsDriveHeadTag under the same switch.
    travelpayouts: {
      marker: travelpayouts.marker,
      brands: travelpayouts.brands,
      enabled: travelpayouts.enabled,
      driveEnabled: travelpayouts.driveEnabled,
      driveProjectId: travelpayouts.driveProjectId,
      // Empty until a partner program id is set. Compare prices reads brands only.
      extras: extras.groups
    }
  };
  const payload = JSON.stringify(config).replace(/</g, '\\u003c');
  const script = `<script id="makaug-short-term-config">window.__makaugShortTerm=${payload};</script>`;
  const pattern = /<script\b(?=[^>]*id=["']makaug-short-term-config["'])[^>]*>[\s\S]*?<\/script>/i;
  if (pattern.test(source)) return source.replace(pattern, script);
  return source.replace('</head>', `  ${script}\n</head>`);
}

module.exports = {
  AFCON_2027_KICKOFF,
  SHORT_TERM_NODE_ATTRIBUTE,
  applyShortTermVisibility,
  envFlagEnabled,
  injectShortTermRuntimeConfig,
  shortTermCountdownTarget,
  shortTermCountdownEnabled,
  publicWhatsappDigits,
  shortTermEnabled,
  shortTermIntakeEnabled,
  shortTermReviewsEnabled
};
