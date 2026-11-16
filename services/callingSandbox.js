'use strict';

/**
 * Practice ("sandbox") callers, e.g. "Arthur (test)".
 *
 * A practice caller is a staff login with profile_data.sandbox = true. It only
 * ever sees TEST practice numbers (phone keys 7000001NN, checked unused in
 * production), nothing it does is sent to anyone, it can never make a payment
 * claim, and it is left out of every team total. Real callers never get TEST
 * numbers. See migration 237.
 */
const db = require('../config/database');

const TEST_PREFIX = '7000001';
const PRACTICE_COUNT = 24;
const NAMES = ['Nakato Grace', 'Ssemakula John', 'Achieng Mary', 'Okello Peter', 'Namubiru Sarah', 'Mugisha David', 'Atuhaire Joan', 'Kato Ivan',
  'Nabukenya Rose', 'Opio Samuel', 'Kyomugisha Ann', 'Waiswa Brian', 'Nansubuga Esther', 'Byaruhanga Paul', 'Akello Faith', 'Lubega Moses',
  'Nalwoga Diana', 'Tumusiime Eric', 'Auma Brenda', 'Ssali Henry', 'Nakimuli Ruth', 'Ochieng Tom', 'Babirye Lydia', 'Mukasa Ronald'];
/** SQL: leave practice callers out of a team total. */
const REAL_PEOPLE = (col = 'person_key') => `${col} NOT IN (SELECT person_key FROM calling_sandbox_people)`;
/** The same, written so a missing view (before migration 237) does not break a query. */
const PRACTICE_MSG = 'Practice account (TEST): nothing was sent and nothing counts. In a real call this button';

function isTestKey(key) { return /^7000001\d{2}$/.test(String(key || '')); }
function isTestPhone(phone) { const d = String(phone || '').replace(/\D/g, ''); return isTestKey(d.slice(-9)) && (d.length === 9 || d.length === 10 || d.startsWith('256')); }

/** The fake numbers a practice caller works through (never real phones). */
function practiceNumbers() {
  return NAMES.slice(0, PRACTICE_COUNT).map((n, i) => {
    const key = `${TEST_PREFIX}${String(i + 1).padStart(2, '0')}`;
    return { phone: `+256${key}`, phone_key: key, full_name: `TEST – ${n}` };
  });
}

let cache = { at: 0, keys: new Set() };
async function sandboxKeys() {
  if (Date.now() - cache.at < 30000) return cache.keys;
  const r = await db.query('SELECT person_key FROM calling_sandbox_people').catch(() => ({ rows: [] }));
  cache = { at: Date.now(), keys: new Set((r.rows || []).map((x) => x.person_key).filter(Boolean)) };
  return cache.keys;
}
function clearCache() { cache = { at: 0, keys: new Set() }; }
async function isSandbox(personKey) { return Boolean(personKey) && (await sandboxKeys()).has(String(personKey)); }

module.exports = { TEST_PREFIX, PRACTICE_MSG, REAL_PEOPLE, isTestKey, isTestPhone, practiceNumbers, sandboxKeys, isSandbox, clearCache };
