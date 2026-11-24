'use strict';

/**
 * The one name an agent is greeted by, everywhere.
 *
 * "Agaba Amos" got "Hi Amos" in the 2 Oct broadcast and "Hello Agaba!" from the
 * bot a minute later, because every message took the first word of full_name.
 * agents.greeting_name holds the name they go by; the first word is only the
 * fallback. Agent rows loaded from older sessions or queries may not carry the
 * column, so ids are also looked up in a small cache refreshed in the
 * background.
 */

const TITLES = /^(?:mr|mrs|ms|miss|dr|eng|hon|prof|rev|pastor|sir|madam)\.?$/i;
const cache = new Map();
let loadedAt = 0;
let loading = null;

function firstWord(fullName = '') {
  const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const word = words.find((w) => !TITLES.test(w)) || '';
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
}

// A registered company's name ends in one of these; a person's never does.
const COMPANY_SUFFIX = /[\s,]+(?:\(u\)\s*)?(?:ltd|limited|smc(?:\s+ltd|\s+limited)?|co|company|inc|plc|llc|uganda)\.?\s*$/i;
// What follows a company's own name and is not said in a greeting.
const COMPANY_KIND = /\s+(?:property|properties|real\s+estate|estates?|realtors?|realty|agency|agencies|agents?|homes?|housing|investments?|enterprises?|holdings|group|consult(?:s|ants|ing)?|services?|developers?|management|land|lands|brokers?|solutions|international)\s*$/i;

/**
 * 24 Nov 2026: a new agent was greeted by his company's full registered
 * name, "… Property Services Ltd", the name staff had typed for his page. A
 * company is greeted by its own name, without the Ltd and the kind of business.
 * Names that are not a company's are left as they are.
 */
function greetingFromCompanyName(name = '') {
  const full = String(name || '').replace(/\s+/g, ' ').trim();
  if (!full || !COMPANY_SUFFIX.test(full)) return full;
  let short = full;
  while (COMPANY_SUFFIX.test(short)) short = short.replace(COMPANY_SUFFIX, '').trim();
  while (COMPANY_KIND.test(short)) short = short.replace(COMPANY_KIND, '').trim();
  return short || full.replace(COMPANY_SUFFIX, '').trim() || full;
}

// 24 Nov 2026: profiles opened on a call were saved under where the number was
// found ("tiktok.com", "WhatsApp enquirer") or a stand-in ("Unnamed"). Nobody
// is greeted by one of those, whatever message it is: they get the fallback.
function greetsWell(name = '') {
  try {
    return !require('./callingNames').nameProblem(name);
  } catch (_error) {
    return true;
  }
}

function agentGreetingName(agent = {}, fallback = '') {
  // The cache is updated the moment an admin changes the name, so it wins over
  // a copy of the agent row held in a session or a lookup cache.
  const cached = agent?.id ? cache.get(String(agent.id)) : '';
  const own = String(agent?.greeting_name || '').trim();
  const name = cached ? greetingFromCompanyName(cached) : (own ? greetingFromCompanyName(own) : '');
  if (name && greetsWell(name)) return name;
  const first = firstWord(agent?.full_name || agent?.name || agent?.agent_name || '');
  return first && greetsWell(first) ? first : fallback;
}

async function refreshGreetingNames(db) {
  if (loading) return loading;
  loading = db.query(`SELECT id, greeting_name FROM agents WHERE COALESCE(greeting_name, '') <> '' LIMIT 2000`)
    .then((result) => {
      cache.clear();
      for (const row of result.rows) cache.set(String(row.id), String(row.greeting_name).trim());
      loadedAt = Date.now();
    })
    .catch(() => {})
    .finally(() => { loading = null; });
  return loading;
}

function startGreetingNameCache(db, { everyMs = 5 * 60_000 } = {}) {
  const { BOOT_DELAY_MS } = require('../utils/schedulerStagger');
  setTimeout(() => refreshGreetingNames(db), BOOT_DELAY_MS.greeting_names).unref?.();
  const timer = setInterval(() => refreshGreetingNames(db), everyMs);
  timer.unref?.();
  return timer;
}

function setCachedGreetingName(agentId, name) {
  if (!agentId) return;
  if (name) cache.set(String(agentId), String(name).trim());
  else cache.delete(String(agentId));
}

module.exports = { agentGreetingName, greetingFromCompanyName, firstWord, refreshGreetingNames, startGreetingNameCache, setCachedGreetingName, _cache: cache, _loadedAt: () => loadedAt };
