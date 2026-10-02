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

function agentGreetingName(agent = {}, fallback = '') {
  // The cache is updated the moment an admin changes the name, so it wins over
  // a copy of the agent row held in a session or a lookup cache.
  const cached = agent?.id ? cache.get(String(agent.id)) : '';
  if (cached) return cached;
  const own = String(agent?.greeting_name || '').trim();
  if (own) return own;
  return firstWord(agent?.full_name || agent?.name || agent?.agent_name || '') || fallback;
}

async function refreshGreetingNames(db) {
  if (loading) return loading;
  loading = db.query(`SELECT id, greeting_name FROM agents WHERE COALESCE(greeting_name, '') <> ''`)
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
  refreshGreetingNames(db);
  const timer = setInterval(() => refreshGreetingNames(db), everyMs);
  timer.unref?.();
  return timer;
}

function setCachedGreetingName(agentId, name) {
  if (!agentId) return;
  if (name) cache.set(String(agentId), String(name).trim());
  else cache.delete(String(agentId));
}

module.exports = { agentGreetingName, firstWord, refreshGreetingNames, startGreetingNameCache, setCachedGreetingName, _cache: cache, _loadedAt: () => loadedAt };
