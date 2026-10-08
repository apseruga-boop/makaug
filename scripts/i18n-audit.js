#!/usr/bin/env node
'use strict';

/**
 * Read-only audit of the site phrase packs (assets/i18n/site-<lang>.json).
 * For every non-English UI language it lists phrases whose value
 *   - equals the English source text (probably untranslated), or
 *   - equals another language's value for the same phrase (borrowed, e.g. the
 *     Luganda "omulundi gumu" showing in Acholi).
 * It never translates anything; the gaps are for Arthur to assign.
 *
 *   node scripts/i18n-audit.js                 # summary table
 *   node scripts/i18n-audit.js --json          # full report as JSON
 *   node scripts/i18n-audit.js --lang ac --limit 50
 *   node scripts/i18n-audit.js --keys "once,month,Land title"
 */

const fs = require('fs');
const path = require('path');

const LANGS = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
const LANGUAGE_NAMES = {
  lg: 'Luganda', sw: 'Swahili', ac: 'Acholi', ny: 'Runyankole', rn: 'Rukiga/Runyoro', sm: 'Lusoga', am: 'Amharic', ar: 'Arabic'
};
// Brand names, codes, numbers, URLs and similar are expected to stay the same.
const SAME_IS_FINE = /^[\s\d.,:;/+\-–—%()#@&|•·×xX$€£]*$|^[+\d\s.,-]+\s*(km|m|mi|ha|sqm|ft)$|^\d{1,2} [A-Z][a-z]{2} \d{4}$|^https?:|^\/|\.com\b|^[A-Z0-9_-]{2,}$|^(WhatsApp|TikTok|YouTube|Facebook|Instagram|Google|Makaug|makaug(\.com)?|MTN|Airtel|Visa|Mastercard|email|Email|OK|ID|GPS|PDF|AI|USD|UGX|USh|KES|TZS|RWF|ZAR|km|m²|sqm|ft)$/;

function readPack(lang, dir) {
  const file = path.join(dir, `site-${lang}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.phrases && typeof raw.phrases === 'object' ? raw.phrases : {};
}

function audit({ dir = path.join(__dirname, '..', 'assets', 'i18n'), langs = LANGS, keys = null } = {}) {
  const packs = Object.fromEntries(langs.map((lang) => [lang, readPack(lang, dir)]).filter(([, pack]) => pack));
  const report = {};
  for (const [lang, phrases] of Object.entries(packs)) {
    const sameAsEnglish = [];
    const sameAsOther = [];
    const missingKeys = [];
    const entries = keys ? keys.map((key) => [key, phrases[key]]) : Object.entries(phrases);
    for (const [english, value] of entries) {
      if (value === undefined) { missingKeys.push(english); continue; }
      const text = String(value || '').trim();
      if (!text || SAME_IS_FINE.test(english.trim())) continue;
      if (text === english.trim()) { sameAsEnglish.push(english); continue; }
      const borrowedFrom = Object.entries(packs)
        .filter(([other]) => other !== lang)
        .filter(([, otherPhrases]) => String(otherPhrases[english] || '').trim() === text)
        .map(([other]) => other);
      // Closely related languages may legitimately share words (lg/sm, ny/rn);
      // report it anyway, with who it matches, so a speaker can judge.
      if (borrowedFrom.length) sameAsOther.push({ phrase: english, value: text, same_as: borrowedFrom });
    }
    report[lang] = {
      language: LANGUAGE_NAMES[lang] || lang,
      phrases: Object.keys(phrases).length,
      same_as_english: sameAsEnglish,
      same_as_other_language: sameAsOther,
      missing: missingKeys
    };
  }
  return report;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  const langs = arg('--lang') ? arg('--lang').split(',') : LANGS;
  const keys = arg('--keys') ? arg('--keys').split(',').map((key) => key.trim()) : null;
  const limit = Number(arg('--limit') || 15);
  const report = audit({ langs, keys });
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('| Language | Phrases | Same as English | Same as another language | Missing |');
  console.log('|---|---:|---:|---:|---:|');
  for (const [lang, row] of Object.entries(report)) {
    console.log(`| ${row.language} (${lang}) | ${row.phrases} | ${row.same_as_english.length} | ${row.same_as_other_language.length} | ${row.missing.length} |`);
  }
  for (const [lang, row] of Object.entries(report)) {
    if (!row.same_as_english.length && !row.same_as_other_language.length && !row.missing.length) continue;
    console.log(`\n## ${row.language} (${lang})`);
    if (row.missing.length) console.log(`Missing: ${row.missing.slice(0, limit).join(' · ')}`);
    if (row.same_as_english.length) console.log(`Same as English (first ${Math.min(limit, row.same_as_english.length)}): ${row.same_as_english.slice(0, limit).map((p) => JSON.stringify(p)).join(', ')}`);
    if (row.same_as_other_language.length) {
      console.log(`Same as another language (first ${Math.min(limit, row.same_as_other_language.length)}):`);
      row.same_as_other_language.slice(0, limit).forEach((item) => console.log(`  - ${JSON.stringify(item.phrase)} → ${JSON.stringify(item.value)} (= ${item.same_as.join(', ')})`));
    }
  }
}

if (require.main === module) main();

module.exports = { audit, LANGS };
