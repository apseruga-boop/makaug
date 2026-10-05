const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const consentSource = fs.readFileSync(path.join(root, 'assets', 'measurement-consent.js'), 'utf8');
const offPlanSource = fs.readFileSync(path.join(root, 'assets', 'off-plan.js'), 'utf8');
const shortTermSource = fs.readFileSync(path.join(root, 'assets', 'short-term.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const offPlanRouteSource = fs.readFileSync(path.join(root, 'routes', 'off-plan.js'), 'utf8');
const shortTermRouteSource = fs.readFileSync(path.join(root, 'routes', 'short-term.js'), 'utf8');
const propertiesRouteSource = fs.readFileSync(path.join(root, 'routes', 'properties.js'), 'utf8');
const advertisingRouteSource = fs.readFileSync(path.join(root, 'routes', 'advertising.js'), 'utf8');
const leadServiceSource = fs.readFileSync(path.join(root, 'services', 'leadService.js'), 'utf8');
const {
  currentLeadAttribution,
  enforceLeadAttributionConsent,
  leadAttributionContext,
  normalizeLeadAttribution
} = require('../services/leadAttributionContext');
const { createLead } = require('../services/leadService');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function runConsentController({ choice = null, countryCode = 'UG', metaPixelId = '', openAIAdsPixelId = '', publicName = '', search = '', sessionAttribution = null } = {}) {
  const insertedScripts = [];
  const consentStorageKey = countryCode === 'UG'
    ? 'makaug_measurement_consent_v1'
    : `property_${countryCode.toLowerCase()}_measurement_consent_v1`;
  const localStorage = memoryStorage(choice
    ? { [consentStorageKey]: JSON.stringify(choice) }
    : {});
  const firstScript = {
    parentNode: {
      insertBefore(script) {
        insertedScripts.push(script);
      }
    }
  };
  const document = {
    body: null,
    cookie: '',
    readyState: 'loading',
    addEventListener() {},
    createElement(tagName) {
      return {
        attributes: {},
        tagName,
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        }
      };
    },
    getElementById() {
      return null;
    },
    getElementsByTagName(tagName) {
      return tagName === 'script' ? [firstScript] : [];
    },
    querySelectorAll() {
      return [];
    }
  };
  const sessionStorage = memoryStorage(sessionAttribution
    ? { makaug_traffic_attribution_v2: JSON.stringify(sessionAttribution) }
    : {});
  const window = {
    __makaugMetaPixelId: metaPixelId,
    addEventListener() {},
    dispatchEvent() {},
    localStorage,
    sessionStorage,
    location: {
      hash: '',
      hostname: 'makaug.com',
      pathname: '/for-sale/najjera-wakiso',
      protocol: 'https:',
      search,
      reload() {}
    }
  };
  // Bracket notation avoids accidentally turning the public runtime variable
  // names into test-time globals.
  window['MAKAUG_CONFIG'] = { countryCode, openAIAdsPixelId, publicName };
  window['MAKAUG_OPENAI_ADS_PIXEL_ID'] = openAIAdsPixelId;

  class FakeCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  }

  vm.runInNewContext(consentSource, {
    CustomEvent: FakeCustomEvent,
    document,
    URLSearchParams,
    window
  }, { filename: 'measurement-consent.js' });

  return { document, insertedScripts, sessionStorage, window };
}

function attributionRuntime({ search, analytics, advertising }) {
  const start = app.indexOf('function measurementConsentSnapshot()');
  const end = app.indexOf('function analyticsVisitorTimezone()', start);
  assert.notEqual(start, -1, 'measurement consent helpers must exist in the browser bundle');
  assert.notEqual(end, -1, 'attribution helper boundary must exist in the browser bundle');

  const storage = memoryStorage();
  const window = {
    location: {
      hash: '',
      hostname: 'makaug.com',
      href: `https://makaug.com/for-sale/najjera-wakiso${search}`,
      pathname: '/for-sale/najjera-wakiso',
      search
    },
    makaugMeasurementConsent: {
      allowsAdvertising: () => advertising,
      allowsAnalytics: () => analytics,
      snapshot: () => ({ analytics, advertising, version: '1' })
    },
    sessionStorage: storage
  };
  const context = {
    URL,
    URLSearchParams,
    document: { referrer: '' },
    localStorage: memoryStorage(),
    window
  };
  const selectedSource = app.slice(start, end);
  vm.runInNewContext(`
    const MEASUREMENT_CONSENT_VERSION = "1";
    const TRAFFIC_ATTRIBUTION_KEY = "makaug_traffic_attribution_v2";
    const ANALYTICS_CLIENT_KEY = "makaug_analytics_client_id";
    let trafficAttributionCache = null;
    ${selectedSource}
    globalThis.__attribution = { leadAttributionPayload, trafficAttributionParams };
  `, context, { filename: 'makaug-attribution-helpers.js' });
  return context.__attribution;
}

test('optional measurement is denied by default and no advertising SDK is loaded', () => {
  const { insertedScripts, sessionStorage, window } = runConsentController({
    sessionAttribution: { utm_content: 'stale-creative', oppref: 'stale-click' }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(window.makaugMeasurementConsent.snapshot())), {
    analytics: false,
    advertising: false,
    version: '1',
    decided_at: ''
  });
  assert.equal(window.makaugMeasurementConsent.allowsAnalytics(), false);
  assert.equal(window.makaugMeasurementConsent.allowsAdvertising(), false);
  assert.equal(window.fbq, undefined);
  assert.equal(window.oaiq, undefined);
  assert.deepEqual(insertedScripts, []);
  assert.equal(sessionStorage.getItem('makaug_traffic_attribution_v2'), null);
});

test('consent UI provides granular analytics and advertising choices', () => {
  assert.match(consentSource, /Accept optional/);
  assert.match(consentSource, /Use essential only/);
  assert.match(consentSource, /id="makaug-consent-analytics" type="checkbox"/);
  assert.match(consentSource, /id="makaug-consent-advertising" type="checkbox"/);
  assert.match(consentSource, /data-consent-action="save"/);
  assert.match(html, /id="footer-cookie-settings"[^>]+onclick="openMakaugCookieSettings\(\)"/);
  assert.match(consentSource, /MAKAUG_CONFIG\?\.publicName/);
  assert.doesNotMatch(consentSource, /Essential storage keeps makaug secure/);
});

test('OpenAI Ads consent is queued before initialization and lead measurement carries the CRM lead id', () => {
  const choice = {
    analytics: false,
    advertising: true,
    version: '1',
    decided_at: '2026-10-05T08:00:00.000Z'
  };
  const { insertedScripts, window } = runConsentController({
    choice,
    openAIAdsPixelId: 'openai_pixel_123'
  });

  assert.equal(insertedScripts.length, 1);
  assert.equal(insertedScripts[0].src, 'https://bzrcdn.openai.com/sdk/oaiq.min.js');
  assert.deepEqual(Array.from(window.oaiq.q[0]), ['consent', true]);
  assert.equal(window.oaiq.q[1][0], 'init');
  assert.equal(window.oaiq.q[1][1].pixelId, 'openai_pixel_123');

  assert.equal(window.makaugMeasurementConsent.measureOpenAILead('lead-123'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(Array.from(window.oaiq.q[2]))), [
    'measure',
    'lead_created',
    { type: 'customer_action' },
    { event_id: 'lead-123' }
  ]);
});

test('measurement uses the active tenant country instead of hardcoding Uganda', () => {
  const choice = {
    analytics: false,
    advertising: true,
    version: '1',
    decided_at: '2026-10-05T08:00:00.000Z'
  };
  const { window } = runConsentController({ choice, countryCode: 'ZA', metaPixelId: '123456789' });
  const pageView = window.fbq.queue.find((entry) => entry[0] === 'track' && entry[1] === 'PageView');
  assert.equal(pageView[2].site_country, 'ZA');
});

test('the HTML shell does not auto-load optional measurement vendors', () => {
  assert.match(html, /<script src="\/config\.js"><\/script>\s*<script src="\/assets\/measurement-consent\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["'][^"']*connect\.facebook\.net/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["'][^"']*bzrcdn\.openai\.com/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["'][^"']*googletagmanager\.com/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["'][^"']*pagead2\.googlesyndication\.com/i);
});

test('utm_content and oppref are included only under the corresponding consent', () => {
  const search = '?utm_source=openai&utm_medium=paid&utm_campaign=october&utm_content=creative-a&utm_term=villa&oppref=opaque-click';
  const allowed = attributionRuntime({ search, analytics: false, advertising: true }).leadAttributionPayload();
  assert.deepEqual(JSON.parse(JSON.stringify(allowed)), {
    utm_source: 'openai',
    utm_medium: 'paid',
    utm_campaign: 'october',
    utm_content: 'creative-a',
    utm_term: 'villa',
    oppref: 'opaque-click',
    oppref_source_param: 'oppref',
    landing_page: '/for-sale/najjera-wakiso',
    measurement_consent: { analytics: false, advertising: true, version: '1' }
  });

  const analyticsOnly = attributionRuntime({ search, analytics: true, advertising: false }).leadAttributionPayload();
  assert.equal(analyticsOnly.utm_content, 'creative-a');
  assert.equal(analyticsOnly.oppref, undefined);

  const denied = attributionRuntime({ search, analytics: false, advertising: false }).leadAttributionPayload();
  assert.deepEqual(JSON.parse(JSON.stringify(denied)), {
    measurement_consent: { analytics: false, advertising: false, version: '1' }
  });
});

test('the shared consent layer supplies bounded attribution headers to every public lead wrapper', () => {
  const choice = {
    analytics: false,
    advertising: true,
    version: '1',
    decided_at: '2026-10-05T08:00:00.000Z'
  };
  const { window } = runConsentController({
    choice,
    search: '?utm_source=openai&utm_content=off-plan-card&oppref=opaque-click'
  });
  const headers = window.makaugMeasurementConsent.leadAttributionHeaders();
  const payload = JSON.parse(decodeURIComponent(headers['X-Makaug-Lead-Attribution']));

  assert.equal(payload.utm_source, 'openai');
  assert.equal(payload.utm_content, 'off-plan-card');
  assert.equal(payload.oppref, 'opaque-click');
  assert.equal(payload.landing_page, '/for-sale/najjera-wakiso');
  assert.deepEqual(payload.measurement_consent, { analytics: false, advertising: true, version: '1' });
  assert.ok(headers['X-Makaug-Lead-Attribution'].length <= 7000);
  assert.match(app, /makaugMeasurementConsent\?\.leadAttributionHeaders\?\.\(\)/);
  assert.match(offPlanSource, /makaugMeasurementConsent\?\.leadAttributionHeaders\?\.\(\)/);
  assert.match(shortTermSource, /makaugMeasurementConsent\.leadAttributionHeaders\(\)/);
  assert.match(offPlanRouteSource, /lead_id: lead\?\.id \|\| null/);
  assert.match(offPlanSource, /off_plan_enquiry_submitted[^\n]+lead_id: data\.lead_id \|\| null/);
  assert.match(shortTermRouteSource, /lead_id: crmLead\?\.id \|\| null/);
  assert.match(shortTermSource, /short_term_enquiry_submitted[\s\S]{0,160}lead_id: payloadOut\.lead_id \|\| null/);
  assert.match(html, /short-term\.js\?v=20261005-short-term-v24/);
  assert.match(html, /off-plan\.js\?v=20261005-off-plan-v18/);
});

test('withdrawing optional consent purges stored identifiers while analytics-only consent removes oppref', () => {
  const stored = {
    utm_source: 'openai',
    utm_content: 'creative-a',
    oppref: 'opaque-click',
    oppref_source_param: 'oppref',
    landing_page: '/for-sale/najjera-wakiso'
  };
  const denied = runConsentController({
    choice: { analytics: false, advertising: false, version: '1', decided_at: '2026-10-05T08:00:00.000Z' },
    sessionAttribution: stored
  });
  assert.equal(denied.sessionStorage.getItem('makaug_traffic_attribution_v2'), null);

  const analyticsOnly = runConsentController({
    choice: { analytics: true, advertising: false, version: '1', decided_at: '2026-10-05T08:00:00.000Z' },
    sessionAttribution: stored
  });
  const retained = JSON.parse(analyticsOnly.sessionStorage.getItem('makaug_traffic_attribution_v2'));
  assert.equal(retained.utm_content, 'creative-a');
  assert.equal(retained.oppref, undefined);
  assert.equal(retained.oppref_source_param, undefined);
});

test('all measured browser lead conversions carry the CRM lead id returned by their route', () => {
  assert.match(propertiesRouteSource, /lead_id: submissionLead\?\.id \|\| null/);
  assert.match(app, /property_submit[\s\S]{0,260}lead_id: response\?\.data\?\.lead_id \|\| null/);
  assert.match(app, /ai_assistant_property_need_captured[\s\S]{0,220}lead_id: response\?\.data\?\.lead_id \|\| null/);
  assert.match(app, /map_assist_request_submit[^\n]+lead_id: response\?\.data\?\.lead_id \|\| null/);
  assert.match(advertisingRouteSource, /lead_id: lead\?\.id \|\| null/);
  assert.match(app, /advertising_selfserve_submitted[^\n]+lead_id: leadId/);
});

test('click_id is retained as an oppref fallback when advertising consent is granted', () => {
  const attribution = attributionRuntime({
    search: '?utm_content=variant-b&click_id=openai-fallback',
    analytics: false,
    advertising: true
  }).leadAttributionPayload();
  assert.equal(attribution.utm_content, 'variant-b');
  assert.equal(attribution.oppref, 'openai-fallback');
  assert.equal(attribution.oppref_source_param, 'click_id');
});

test('lead attribution normalization allows only bounded campaign fields and consent booleans', () => {
  const normalized = normalizeLeadAttribution({
    utm_content: `  creative\u0000-${'x'.repeat(300)}  `,
    oppref: ' click-token ',
    landing_page: '/student-accommodation',
    unexpected: 'do not retain',
    measurement_consent: {
      analytics: '1',
      advertising: 'false',
      version: 'v12345678901234567890'
    }
  });

  assert.equal(normalized.utm_content.length, 240);
  assert.equal(normalized.utm_content.includes('\u0000'), false);
  assert.equal(normalized.oppref, 'click-token');
  assert.equal(normalized.unexpected, undefined);
  assert.deepEqual(normalized.measurement_consent, {
    analytics: true,
    advertising: false,
    version: 'v123456789012345'
  });
  assert.equal(normalizeLeadAttribution([]), null);
  assert.equal(normalizeLeadAttribution(null), null);
});

test('server consent enforcement drops identifiers that are not permitted', () => {
  const candidate = {
    utm_source: 'openai',
    utm_content: 'creative-a',
    oppref: 'opaque-click',
    landing_page: '/for-sale/najjera-wakiso'
  };
  assert.deepEqual(enforceLeadAttributionConsent({
    ...candidate,
    measurement_consent: { analytics: false, advertising: false, version: '1' }
  }), {
    measurement_consent: { analytics: false, advertising: false, version: '1' }
  });
  assert.deepEqual(enforceLeadAttributionConsent({
    ...candidate,
    measurement_consent: { analytics: true, advertising: false, version: '1' }
  }), {
    utm_source: 'openai',
    utm_content: 'creative-a',
    landing_page: '/for-sale/najjera-wakiso',
    measurement_consent: { analytics: true, advertising: false, version: '1' }
  });
  assert.equal(enforceLeadAttributionConsent(candidate), null);
});

test('AsyncLocalStorage keeps concurrent lead attribution requests isolated', async () => {
  function observe(body, delay) {
    return new Promise((resolve) => {
      leadAttributionContext({ body }, null, () => {
        setTimeout(() => resolve(currentLeadAttribution()), delay);
      });
    });
  }

  const [first, second] = await Promise.all([
    observe({ _lead_attribution: {
      utm_content: 'creative-a',
      oppref: 'click-a',
      measurement_consent: { analytics: false, advertising: true, version: '1' }
    } }, 20),
    observe({ _lead_attribution: {
      utm_content: 'creative-b',
      oppref: 'click-b',
      measurement_consent: { analytics: false, advertising: true, version: '1' }
    } }, 5)
  ]);

  assert.deepEqual(first, {
    utm_content: 'creative-a',
    oppref: 'click-a',
    measurement_consent: { analytics: false, advertising: true, version: '1' }
  });
  assert.deepEqual(second, {
    utm_content: 'creative-b',
    oppref: 'click-b',
    measurement_consent: { analytics: false, advertising: true, version: '1' }
  });
  assert.equal(currentLeadAttribution(), null);
});

test('request attribution is written into the lead metadata JSON', async () => {
  let storedMetadata = null;
  let storedActivityMetadata = null;
  const db = {
    async query(sql, params) {
      if (sql.includes('INSERT INTO leads')) {
        storedMetadata = JSON.parse(params[24]);
        return { rows: [{ id: 'lead-123', metadata: storedMetadata }] };
      }
      if (sql.includes('INSERT INTO lead_activities')) {
        storedActivityMetadata = JSON.parse(params[7]);
        return { rows: [{ id: 'activity-123' }] };
      }
      throw new Error(`Unexpected test query: ${sql.slice(0, 60)}`);
    }
  };

  const lead = await leadAttributionContext({
    body: {
      _lead_attribution: {
        utm_content: 'creative-a',
        oppref: 'opaque-click',
        measurement_consent: { analytics: false, advertising: true, version: '1' }
      }
    }
  }, null, () => createLead(db, {
    dedupe: false,
    leadType: 'property_need',
    metadata: { form: 'property-request' },
    source: 'web'
  }));

  assert.equal(lead.id, 'lead-123');
  assert.deepEqual(storedMetadata.attribution, {
    utm_content: 'creative-a',
    oppref: 'opaque-click',
    measurement_consent: { analytics: false, advertising: true, version: '1' }
  });
  assert.equal(storedMetadata.form, 'property-request');
  assert.deepEqual(storedActivityMetadata, {
    source: 'web',
    lead_type: 'property_need',
    form: 'property-request',
    attribution: {
      utm_content: 'creative-a',
      oppref: 'opaque-click',
      measurement_consent: { analytics: false, advertising: true, version: '1' }
    }
  });
  assert.match(leadServiceSource, /last_attribution: repeatAttribution/);
});

test('explicit lead attribution cannot bypass server-side consent enforcement', async () => {
  let storedMetadata = null;
  let storedActivityMetadata = null;
  const db = {
    async query(sql, params) {
      if (sql.includes('INSERT INTO leads')) {
        storedMetadata = JSON.parse(params[24]);
        return { rows: [{ id: 'lead-denied', metadata: storedMetadata }] };
      }
      if (sql.includes('INSERT INTO lead_activities')) {
        storedActivityMetadata = JSON.parse(params[7]);
        return { rows: [{ id: 'activity-denied' }] };
      }
      throw new Error(`Unexpected test query: ${sql.slice(0, 60)}`);
    }
  };

  await createLead(db, {
    dedupe: false,
    leadType: 'property_need',
    source: 'web',
    metadata: {
      attribution: {
        utm_content: 'must-not-save',
        oppref: 'must-not-save',
        measurement_consent: { analytics: false, advertising: false, version: '1' }
      },
      last_attribution: { oppref: 'must-not-save-either' }
    }
  });

  assert.deepEqual(storedMetadata.attribution, {
    measurement_consent: { analytics: false, advertising: false, version: '1' }
  });
  assert.equal(storedMetadata.last_attribution, undefined);
  assert.deepEqual(storedActivityMetadata, {
    source: 'web',
    lead_type: 'property_need',
    attribution: {
      measurement_consent: { analytics: false, advertising: false, version: '1' }
    }
  });
  assert.equal(storedActivityMetadata.attribution.utm_content, undefined);
  assert.equal(storedActivityMetadata.attribution.oppref, undefined);
  assert.equal(storedActivityMetadata.last_attribution, undefined);
});

test('only public pixel identifiers, never an OpenAI API key, are exposed by config.js', () => {
  assert.match(server, /openAIAdsPixelId: process\.env\.OPENAI_ADS_PIXEL_ID \|\| ''/);
  assert.match(server, /window\.MAKAUG_OPENAI_ADS_PIXEL_ID/);
  const configBlock = server.slice(server.indexOf("app.get('/config.js'"), server.indexOf('const staticRoot'));
  assert.doesNotMatch(configBlock, /OPENAI_API_KEY|apiKey\s*:/);
});

test('browser attribution travels in a bounded header without changing API request bodies', () => {
  assert.match(consentSource, /encoded\.length > 7000/);
  assert.match(consentSource, /"X-Makaug-Lead-Attribution": encoded/);
  assert.match(app, /const requestBody = body;/);
  assert.doesNotMatch(app, /\{ \.\.\.body, _lead_attribution:/);
  assert.match(leadServiceSource, /currentLeadAttribution\(\)/);
});
