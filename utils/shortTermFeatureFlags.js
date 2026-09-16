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

// The countdown target is configuration, never a date baked into the code.
// If SHORT_TERM_COUNTDOWN_TARGET is unset the banner simply does not render,
// which is the right behaviour: better no countdown than a wrong one.
function shortTermCountdownTarget(env = process.env) {
  const raw = String(env.SHORT_TERM_COUNTDOWN_TARGET || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Injected into every public page so the client app knows whether the section
// is live before the visitor navigates to it. With the flag off nothing is
// injected and the client script refuses to boot.
function injectShortTermRuntimeConfig(html, env = process.env) {
  const source = String(html || '');
  if (!shortTermEnabled(env)) return source;
  const config = {
    enabled: true,
    countdown: shortTermCountdownEnabled(env) ? shortTermCountdownTarget(env) : null,
    countdownLabel: String(env.SHORT_TERM_COUNTDOWN_LABEL || 'AFCON 2027').trim()
  };
  const payload = JSON.stringify(config).replace(/</g, '\\u003c');
  const script = `<script id="makaug-short-term-config">window.__makaugShortTerm=${payload};</script>`;
  const pattern = /<script\b(?=[^>]*id=["']makaug-short-term-config["'])[^>]*>[\s\S]*?<\/script>/i;
  if (pattern.test(source)) return source.replace(pattern, script);
  return source.replace('</head>', `  ${script}\n</head>`);
}

module.exports = {
  SHORT_TERM_NODE_ATTRIBUTE,
  applyShortTermVisibility,
  envFlagEnabled,
  injectShortTermRuntimeConfig,
  shortTermCountdownTarget,
  shortTermCountdownEnabled,
  shortTermEnabled,
  shortTermIntakeEnabled,
  shortTermReviewsEnabled
};
