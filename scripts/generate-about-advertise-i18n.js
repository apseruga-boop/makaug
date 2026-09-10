'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP_PATH = path.join(ROOT, 'assets', 'makaug-app.js');
const OUTPUT_PATH = path.join(ROOT, 'assets', 'about-advertise-i18n.js');
const ENDPOINT = 'https://makaug.com/api/ai/translate-text';
const LANGUAGES = Object.freeze({
  lg: 'Luganda',
  sw: 'Kiswahili',
  ac: 'Acholi',
  ny: 'Runyankole',
  rn: 'Rukiga',
  sm: 'Lusoga',
  am: 'Amharic',
  ar: 'Arabic'
});
const CURATED_FALLBACKS = Object.freeze({
  lg: {
    'advertise.previewEmail': 'Weereza email eri makaug',
    'advertise.emailOption': 'Obubaka bwa email'
  },
  ac: {
    'about.finalEmail': 'Cwal email: info@makaug.com',
    'advertise.email': 'Email me kube',
    'advertise.previewEmail': 'Cwal email bot makaug',
    'advertise.contactEmail': 'Cwal email: info@makaug.com',
    'advertise.map': 'Map me kabedo',
    'advertise.package.whatsapp_chatbot_sponsor.label': 'Sponsor pa WhatsApp Chatbot',
    'advertise.package.email_whatsapp_blast.locations': 'Campaign me Email|Campaign me WhatsApp'
  },
  ny: {
    'advertise.contactEmail': 'Yoherereza email: info@makaug.com',
    'advertise.emailOption': 'Obutumwa bwa email',
    'advertise.map': 'Maapu',
    'advertise.package.whatsapp_chatbot_sponsor.label': 'Omushagiki wa WhatsApp Chatbot'
  },
  sm: {
    'about.landHubUgNlis': 'Portal entongole ya UgNLIS',
    'about.finalEmail': 'Weereza email: info@makaug.com',
    'advertise.email': 'Email y\'obubaka',
    'advertise.previewEmail': 'Weereza makaug email',
    'advertise.savedForReview': 'Campaign {reference} eterekeddwa okusunsulwa. Nga emazze okukakasibwa, dashboard y\'omuweereza w\'obulango erakulaga link ey\'okusasulira etebenkevu. Campaign etandika nga okusasula kumaze okukolebwa.',
    'advertise.briefSaved': 'Ebikwata ku campaign biterekeddwa namba {reference}. {createAccount} oba {signIn} okukola oda era ogende mu maaso n\'okusasula okutebenkevu.',
    'advertise.contactEmail': 'Weereza email: info@makaug.com',
    'advertise.browserBrand': 'makaug.com · Property ya Uganda',
    'advertise.package.regional_search_boost.description': 'Teeka property, agent oba business mu maaso g\'abantu abanoonya mu district n\'ebitundu by\'olonze.',
    'advertise.package.email_whatsapp_blast.locations': 'Campaign ya Email|Campaign ya WhatsApp',
    'advertise.package.email_whatsapp_blast.capture': 'Campaign ya Email',
    'advertise.package.haymaker_all_platform.locations': 'Homepage|Okunoonya|Map|WhatsApp|Email|Cards za agents'
  }
});

function extractFrozenObject(source, name) {
  const marker = `const ${name} = Object.freeze({`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name}`);
  const bodyStart = start + marker.length;
  const end = source.indexOf('\n});', bodyStart);
  if (end < 0) throw new Error(`Could not find end of ${name}`);
  const body = source.slice(bodyStart, end);
  const values = {};
  const pattern = /"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = pattern.exec(body))) {
    values[match[1]] = JSON.parse(`"${match[2]}"`);
  }
  return values;
}

function chunksFor(values, maxLength = 900) {
  const chunks = [];
  let current = {};
  for (const [key, value] of Object.entries(values)) {
    const candidate = { ...current, [key]: value };
    if (Object.keys(current).length && JSON.stringify(candidate).length > maxLength) {
      chunks.push(current);
      current = { [key]: value };
    } else {
      current = candidate;
    }
  }
  if (Object.keys(current).length) chunks.push(current);
  return chunks;
}

function parseTranslatedObject(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Translation was not a JSON object');
  return parsed;
}

function placeholderTokens(value) {
  return Array.from(String(value || '').matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g), (match) => match[1]).sort();
}

function markupTokens(value) {
  return Array.from(String(value || '').matchAll(/<\/?[a-z][^>]*>/gi), (match) => match[0]).sort();
}

const SAME_VALUE_KEYS = new Set([
  'about.discoveryYoutubeTitle',
  'about.discoveryTikTokTitle',
  'about.discoveryGoogleTitle',
  'advertise.targetAreasPlaceholder',
  'advertise.contactWhatsapp',
  'advertise.whatsappOption'
]);

function mustDifferFromEnglish(key, value) {
  if (SAME_VALUE_KEYS.has(key)) return false;
  return /[A-Za-z]/.test(String(value || ''));
}

function validTranslation(key, translated, source) {
  return typeof translated?.[key] === 'string'
    && translated[key].trim()
    && JSON.stringify(placeholderTokens(translated[key])) === JSON.stringify(placeholderTokens(source[key]))
    && JSON.stringify(markupTokens(translated[key])) === JSON.stringify(markupTokens(source[key]))
    && (!mustDifferFromEnglish(key, source[key]) || translated[key].trim() !== String(source[key]).trim());
}

function splitTranslationText(value, maxLength = 60) {
  const segments = [];
  const sentences = String(value || '').trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  for (const sentence of sentences) {
    let remaining = sentence.trim();
    while (remaining.length > maxLength) {
      let cut = remaining.lastIndexOf(' ', maxLength);
      if (cut < Math.floor(maxLength * 0.6)) cut = maxLength;
      segments.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) segments.push(remaining);
  }
  return segments;
}

async function translateChunk(code, languageName, chunk, index, attempts = 3) {
  let lastError;
  if (Object.keys(chunk).length === 1 && String(Object.values(chunk)[0] || '').length > 100) attempts = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          text: JSON.stringify(chunk),
          source_language: 'en',
          target_language: code,
          context: `Public makaug About and Advertise interface copy. Translate every JSON value naturally into ${languageName}. Preserve every JSON key, {placeholder} token, HTML tag and attribute exactly, and return valid JSON. Keep makaug, WhatsApp, YouTube, TikTok, Google, X, UgNLIS, URLs, currency codes, numbers and Uganda place names unchanged. Do not shorten, remove or add claims.`,
          source: 'about_advertise_i18n_release_20260910'
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.data?.fallback_used) throw new Error(`Translation fallback: ${payload?.data?.fallback_reason || 'source text returned'}`);
      const translated = parseTranslatedObject(payload?.data?.translated_text);
      const missing = Object.keys(chunk).filter((key) => !validTranslation(key, translated, chunk));
      if (missing.length) throw new Error(`Missing keys: ${missing.join(', ')}`);
      return translated;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
  const translated = {};
  for (const [key, value] of Object.entries(chunk)) {
    try {
      const segments = String(value || '').length > 100 ? splitTranslationText(value) : [String(value)];
      const translatedSegments = [];
      for (const segment of segments) {
        try {
          let payload;
          let segmentError;
          for (let requestAttempt = 1; requestAttempt <= 6; requestAttempt += 1) {
            try {
              const requestBody = JSON.stringify({
                text: segment.trim(),
                source_language: 'en',
                target_language: code,
                context: `Translate this public property website sentence naturally into ${languageName}. Return only the translated text.`,
                source: `about_advertise_i18n_single_20260910_${requestAttempt}`
              });
              const raw = execFileSync('curl', [
                '--silent', '--show-error', '--fail', '--max-time', '12',
                '--header', 'content-type: application/json',
                '--data', requestBody,
                ENDPOINT
              ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
              payload = JSON.parse(raw);
              const candidate = String(payload?.data?.translated_text || '').trim();
              const segmentWords = segment.match(/[A-Za-z][A-Za-z'-]*/g) || [];
              if (payload?.data?.fallback_used || (segmentWords.length >= 3 && candidate === segment.trim())) {
                throw new Error(`Untranslated fallback: ${payload?.data?.fallback_reason || 'source text returned'}`);
              }
              break;
            } catch (error) {
              segmentError = error;
            }
          }
          if (!payload) throw segmentError || new Error('Translation request did not return a payload');
          translatedSegments.push(String(payload?.data?.translated_text || '').trim());
        } catch (error) {
          throw new Error(`segment \"${segment}\": ${error?.message || error}`);
        }
      }
      translated[key] = translatedSegments.join(' ').trim();
      if (!validTranslation(key, translated, chunk)) throw new Error('Placeholder or markup mismatch');
    } catch (error) {
      throw new Error(`${languageName} chunk ${index + 1} and key ${key} failed: ${error?.message || error}; earlier error: ${lastError?.message || lastError}`);
    }
  }
  return translated;
}

async function main() {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const values = {
    ...extractFrozenObject(source, 'ABOUT_PAGE_I18N_EN'),
    ...extractFrozenObject(source, 'ADVERTISING_UI_I18N_EN')
  };
  const translations = {};
  const tasks = [];
  for (const [code, languageName] of Object.entries(LANGUAGES)) {
    const cachePath = path.join('/private/tmp', `makaug-about-advertise-${code}.json`);
    try { translations[code] = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (error) { translations[code] = {}; }
    Object.assign(translations[code], CURATED_FALLBACKS[code] || {});
    const chunks = chunksFor(values);
    chunks.forEach((chunk, index) => {
      const pending = Object.fromEntries(Object.entries(chunk).filter(([key]) => !validTranslation(key, translations[code], values)));
      if (Object.keys(pending).length) tasks.push({ code, languageName, chunk: pending, index, total: chunks.length, cachePath });
    });
  }
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      try {
        Object.assign(translations[task.code], await translateChunk(task.code, task.languageName, task.chunk, task.index, 2));
        fs.writeFileSync(task.cachePath, JSON.stringify(translations[task.code], null, 2));
        process.stdout.write(`${task.code} ${task.index + 1}/${task.total}\n`);
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const missing = [];
  for (const code of Object.keys(LANGUAGES)) {
    for (const key of Object.keys(values)) {
      if (!validTranslation(key, translations[code], values)) missing.push(`${code}:${key}`);
    }
  }
  if (missing.length) throw new Error(`Generated translation coverage is incomplete: ${missing.join(', ')}`);
  const header = `'use strict';\n\n// Generated from reviewed English UI keys for the nine-language About and Advertise release.\n`;
  fs.writeFileSync(OUTPUT_PATH, `${header}window.__MAKAUG_ABOUT_ADVERTISE_I18N__ = Object.freeze(${JSON.stringify(translations, null, 2)});\n`);
  process.stdout.write(`wrote ${OUTPUT_PATH} with ${Object.keys(values).length} keys across ${Object.keys(LANGUAGES).length} languages\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
