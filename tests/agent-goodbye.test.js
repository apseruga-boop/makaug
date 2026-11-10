'use strict';

/**
 * Removing an agent from King, by reason (Arthur, 10 Nov 2026). When an agent
 * leaves because they cancelled: their properties come off makaug, their
 * profile and login close, their WhatsApp is set back to an ordinary number,
 * and they get a short goodbye message and a personal goodbye film (properties
 * live, people, countries, and the overall views with social media: the site's views x 20). Their
 * ID and personal details are deleted 30 days later unless they come back;
 * their name and number are kept. They come back on makaug's own WhatsApp.
 * The other reasons send nothing and delete nothing.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');

// The bridge queue is bound when routes/admin.js loads: stub it first.
const bridge = require('../services/whatsappWebBridgeService');
const queued = [];
bridge.queueWhatsappWebBridgeMessage = async (args) => { queued.push(args); return { id: `q${queued.length}` }; };

const db = require('../config/database');
const goodbye = require('../services/agentGoodbyeService');
const videos = require('../services/agentReportVideoService');
const adminRouter = require('../routes/admin');

// The removal notice to Arthur and Ronald is tested on its own below; the
// route tests never send it anywhere.
const realAlertRemoval = goodbye.alertRemoval;
goodbye.alertRemoval = async () => [];

const AGENT_ID = 'e1d9a5f5-ce49-4e9d-a9ca-1cad1c78d3ef';

const fullPayload = () => ({
  agent: { id: AGENT_ID, full_name: 'George Wanyama', greeting_name: 'George' },
  stats: {
    properties_live: 3, listings_up: 3, views: 59, visitors: 41, enquiries: 1, country_count: 5,
    countries: [{ code: 'UG', name: 'Uganda', visitors: 31 }, { code: 'GB', name: 'United Kingdom', visitors: 4 }, { code: 'US', name: 'United States', visitors: 3 }, { code: 'KE', name: 'Kenya', visitors: 2 }, { code: 'AE', name: 'United Arab Emirates', visitors: 1 }],
    top_listings: [{ title: 'property for rent in Mutungo', area: 'Mutungo, Kampala', views: 21 }, { title: 'property for rent in Kireka', area: 'Kireka, Wakiso', views: 17 }],
    views_multiplier: 20, overall_views: 1180
  },
  contact: { name: 'makaug', digits: '256780863394', pretty: '+256 780 863 394' },
  keep_days: 30
});

const quietPayload = () => ({
  agent: { id: AGENT_ID, full_name: 'Smartway homes', greeting_name: 'Smartway' },
  stats: { properties_live: 0, listings_up: 0, views: 0, visitors: 0, enquiries: 0, country_count: 0, countries: [], top_listings: [], overall_views: 0 },
  contact: { name: 'makaug', digits: '256780863394', pretty: '+256 780 863 394' },
  keep_days: 30
});

test('staff choose a reason, and only "They cancelled" sends anything or deletes details', () => {
  const codes = goodbye.REMOVAL_REASONS.map((r) => r.code);
  assert.deepStrictEqual(codes, ['cancelled', 'not_paying', 'rules', 'duplicate', 'other']);
  const sends = goodbye.REMOVAL_REASONS.filter((r) => r.goodbye).map((r) => r.code);
  const deletes = goodbye.REMOVAL_REASONS.filter((r) => r.deletePersonal).map((r) => r.code);
  assert.deepStrictEqual(sends, ['cancelled']);
  assert.deepStrictEqual(deletes, ['cancelled'], 'a rule-breaker\'s ID is kept for fraud or police requests');
  assert.strictEqual(goodbye.removalReason('CANCELLED').code, 'cancelled');
  assert.strictEqual(goodbye.removalReason('nonsense'), null);
  assert.strictEqual(goodbye.removedReasonText(goodbye.removalReason('cancelled'), 'moving to Nairobi'), "They're leaving: cancelled or won't pay — moving to Nairobi");
  assert.strictEqual(goodbye.removedReasonText(goodbye.removalReason('other'), 'duplicate of Charles'), 'duplicate of Charles');
  assert.ok(goodbye.describeRemoval(goodbye.removalReason('duplicate')).some((line) => /Nothing is sent/.test(line)));
  assert.ok(goodbye.describeRemoval(goodbye.removalReason('cancelled')).some((line) => /goodbye message/.test(line)));
  assert.ok(goodbye.describeRemoval(goodbye.removalReason('cancelled')).some((line) => /In 30 days their ID photos/.test(line) && /Restore them before then and nothing is lost/.test(line)));
});

test('the goodbye message is short: properties down, sorry to see you go, details deleted in 30 days, come back on makaug\'s WhatsApp', () => {
  const text = goodbye.buildGoodbyeMessage(fullPayload());
  assert.strictEqual(text, [
    'Hi George,',
    '',
    "Your properties are now off makaug.com and your agent account is closed, so you won't get any more agent messages from us. We're sad to see you go, and thank you for listing with us. Your goodbye film is below.",
    '',
    "We'll delete your ID and personal details after 30 days, in case you change your mind before then. We keep your number, so whenever you want to come back, just WhatsApp makaug on +256 780 863 394.",
    '',
    'Phillip, makaug.com'
  ].join('\n'));
  assert.ok(text.length < 600, `short, got ${text.length} characters`);
  assert.ok(!/Ronald|709 402 189/.test(text), 'makaug\'s own number, not a staff member\'s');
  assert.ok(!/Arthur/.test(text), 'never signed as Arthur');
  assert.ok(!/UGX|free|fee/i.test(text), 'a goodbye says nothing about money');
  assert.match(goodbye.buildGoodbyeCaption(fullPayload()), /Thank you, George/);
  assert.deepStrictEqual(goodbye.makaugWhatsapp(), { name: 'makaug', digits: '256780863394', pretty: '+256 780 863 394' });
});

test('an agent whose properties never went live gets the same short goodbye without the properties', () => {
  const text = goodbye.buildGoodbyeMessage(quietPayload());
  assert.match(text, /^Hi Smartway,\n\nYour agent account on makaug\.com is closed, so you won't get any more agent messages from us\./);
  assert.match(text, /thank you for joining us/);
  assert.match(text, /Phillip, makaug\.com$/);
});

test('overall views are the site\'s views x 20 (social media), said as "about"', () => {
  assert.strictEqual(goodbye.overallViewsMultiplier({}), 20);
  assert.strictEqual(goodbye.overallViewsMultiplier({ AGENT_OVERALL_VIEWS_MULTIPLIER: '25' }), 25);
  assert.strictEqual(goodbye.overallViewsMultiplier({ AGENT_OVERALL_VIEWS_MULTIPLIER: 'lots' }), 20);
  assert.strictEqual(goodbye.aboutFigure(1180), 1200);
  assert.strictEqual(goodbye.aboutFigure(87), 87);
  assert.strictEqual(goodbye.aboutFigure(236), 240);
  assert.strictEqual(goodbye.aboutFigure(4567), 4600);
  assert.strictEqual(goodbye.detailKeepDays({}), 30);
});

test('lifetime stats: properties that went live, people, countries (no bare codes), enquiries and reach', async () => {
  const fake = { async query(sql) {
    if (/FROM properties p\s+WHERE p\.agent_id/.test(sql)) {
      return { rows: [
        { id: 'p1', title: 'property for rent in Mutungo', area: 'Mutungo', district: 'Kampala', status: 'approved', approved_at: '2026-10-23' },
        { id: 'p2', title: 'property for rent in Kireka', area: 'Kireka', district: 'Wakiso', status: 'hidden', approved_at: '2026-10-23' },
        { id: 'p3', title: 'Plot in Gayaza', area: 'Gayaza', district: 'Wakiso', status: 'pending', approved_at: null }
      ] };
    }
    if (/COUNT\(DISTINCT e\.country_code\)/.test(sql)) return { rows: [{ views: 59, visitors: 41, country_count: 4 }] };
    if (/GROUP BY 1\s+ORDER BY 2 DESC, 1/.test(sql)) return { rows: [{ code: 'UG', visitors: 31 }, { code: 'GB', visitors: 4 }, { code: 'BR', visitors: 2 }, { code: 'XX', visitors: 1 }] };
    if (/GROUP BY 1/.test(sql)) return { rows: [{ id: 'p1', views: 42, visitors: 30 }, { id: 'p2', views: 17, visitors: 11 }] };
    if (/FROM leads l/.test(sql)) return { rows: [{ enquiries: 1, whatsapp_clicks: 2 }] };
    return { rows: [] };
  } };
  const s = await goodbye.lifetimeStats(AGENT_ID, { dbc: fake });
  assert.strictEqual(s.properties_live, 2, 'the pending plot never went live');
  assert.strictEqual(s.listings_up, 2, 'approved and pending are what comes down');
  assert.strictEqual(s.visitors, 41);
  assert.strictEqual(s.views, 59);
  assert.strictEqual(s.enquiries, 3);
  assert.deepStrictEqual(s.countries.map((c) => c.name), ['Uganda', 'United Kingdom'], 'BR has no name here and XX is unknown');
  assert.strictEqual(s.country_count, 4);
  assert.strictEqual(s.overall_views, 1180, 'the site\'s 59 views x 20');
  assert.deepStrictEqual(s.top_listings.map((l) => [l.title, l.views]), [['property for rent in Mutungo', 42], ['property for rent in Kireka', 17]]);
});

test('the goodbye film: thank you, properties, people, countries, overall views x20, offline, makaug\'s WhatsApp, see you', () => {
  const full = videos.buildGoodbyeTimeline(fullPayload());
  assert.strictEqual(full.scenes.length, 8);
  assert.ok(full.duration > 18 && full.duration < 30, `about 20 seconds, got ${full.duration}`);
  const scene = videos.buildGoodbyeScenes(fullPayload());
  const at = (t) => videos.frameSvg(scene, t);
  assert.match(at(1.5), /Thank you,/);
  assert.match(at(1.5), /George/);
  const text = full.scenes.map((sc) => videos.frameSvg(() => sc.draw(sc.dur - 0.5, sc.start + sc.dur - 0.5, sc.dur).join(''), 0)).join('');
  assert.match(text, /properties went live/);
  assert.match(text, /people looked/);
  assert.match(text, /From 5 countries/);
  assert.match(text, /With our social media/);
  assert.match(text, /about 1,200/, 'the 59 views on makaug x 20, rounded');
  assert.match(text, /views in total/);
  assert.ok(!/people reached/.test(text));
  assert.ok(!/21 views/.test(text), 'listing rows show where, not the site-only views');
  assert.match(text, /Mutungo, Kampala/);
  assert.match(text, /offline now/);
  assert.match(text, /we keep your number for when you come back/);
  assert.match(text, /always open/);
  assert.match(text, /WhatsApp makaug/);
  assert.match(text, /\+256 780 863 394/);
  assert.ok(!/Ronald|709 402 189/.test(text));
  assert.match(text, /See you again, George/);

  const quiet = videos.buildGoodbyeTimeline(quietPayload());
  assert.strictEqual(quiet.scenes.length, 4, 'no number scenes when there is nothing to show');
  const quietText = quiet.scenes.map((sc) => sc.draw(sc.dur - 0.5, sc.start + sc.dur - 0.5, sc.dur).join('')).join('');
  assert.match(quietText, /closed now/);
  assert.ok(!/offline now/.test(quietText));
});

test('the film link is signed, and the preview has its own cache file', () => {
  const url = videos.goodbyeVideoUrl({ id: AGENT_ID }, 'https://makaug.com', 'p20261110');
  assert.match(url, /^https:\/\/makaug\.com\/api\/agents\/goodbye-video\/e1d9a5f5-ce49-4e9d-a9ca-1cad1c78d3ef\.mp4\?v=p20261110&t=[0-9a-f]{32}$/);
  const cards = require('../services/agentReportCardService');
  const token = url.split('t=')[1];
  assert.ok(cards.verifyCardToken(`${AGENT_ID}:goodbye`, 'p20261110', token));
  assert.ok(!cards.verifyCardToken(`${AGENT_ID}:welcome`, 'p20261110', token), 'a goodbye token opens nothing else');
  const cachePath = videos._test.cachePath;
  assert.notStrictEqual(cachePath(AGENT_ID, 'p20261110', 'goodbye-preview-'), cachePath(AGENT_ID, '20261110', 'goodbye-'));
});

test('the film is made first, so the message only says "film below" when the film follows it', async () => {
  const sent = [];
  const queue = async (args) => { sent.push(args); return { id: `m${sent.length}` }; };
  const fakeVideos = {
    isVideoRenderingAvailable: () => true,
    goodbyeVideoUrl: () => 'https://makaug.com/api/agents/goodbye-video/x.mp4?v=1&t=abc',
    ensureGoodbyeVideo: async () => 'file.mp4'
  };
  const order = [];
  const out = await goodbye.sendGoodbyeNow({ payload: fullPayload(), to: '0772 000 001', version: '1762770000000', queue, videos: fakeVideos, baseUrl: 'https://makaug.com', markMessage: async () => order.push('mark message'), markFilm: async () => order.push('mark film') });
  assert.deepStrictEqual([out.message, out.film], ['sent', 'sent']);
  assert.strictEqual(sent.length, 2);
  assert.match(sent[0].text, /^Hi George,/);
  assert.match(sent[0].text, /Your goodbye film is below\./);
  assert.strictEqual(sent[0].recipient, '0772000001');
  assert.strictEqual(sent[1].mediaType, 'video');
  assert.match(sent[1].text, /Thank you, George/);
  assert.notStrictEqual(sent[0].metadata.reply_dedupe_key, sent[1].metadata.reply_dedupe_key);
  assert.deepStrictEqual(order, ['mark message', 'mark film'], 'each part is recorded before it is queued');

  // The server is too full to make the film: the message goes without the line.
  const sent2 = [];
  const busy = { ...fakeVideos, ensureGoodbyeVideo: async () => { throw Object.assign(new Error('Server memory is high'), { code: 'VIDEO_MEMORY_GUARD' }); } };
  const out2 = await goodbye.sendGoodbyeNow({ payload: fullPayload(), to: '256772000001', version: '1', queue: async (a) => { sent2.push(a); return { id: 'x' }; }, videos: busy, baseUrl: 'https://makaug.com' });
  assert.deepStrictEqual([out2.message, out2.film, out2.film_error], ['sent', 'waiting', 'VIDEO_MEMORY_GUARD']);
  assert.strictEqual(sent2.length, 1);
  assert.ok(!/film is below/.test(sent2[0].text), 'no promise of a film that is not coming yet');
  assert.match(sent2[0].text, /thank you for listing with us\.\n/);

  // A later try sends only the film.
  const sent3 = [];
  const out3 = await goodbye.sendGoodbyeNow({ payload: fullPayload(), to: '256772000001', version: '1', queue: async (a) => { sent3.push(a); return { id: 'y' }; }, videos: fakeVideos, baseUrl: 'https://makaug.com', needMessage: false });
  assert.deepStrictEqual([out3.message, out3.film], ['already_sent', 'sent']);
  assert.deepStrictEqual(sent3.map((m) => m.mediaType || 'text'), ['video']);

  const none = await goodbye.sendGoodbyeNow({ payload: fullPayload(), to: '', version: '1', queue, videos: fakeVideos });
  assert.strictEqual(none.sent, false);
  assert.strictEqual(none.reason, 'no_whatsapp_number');
});

function goodbyeDb(snapshot, { removedAt = new Date().toISOString(), busy = false } = {}) {
  const state = { snapshot: { ...snapshot }, audits: [] };
  const query = async (sql, params = []) => {
    if (/jsonb_build_object\('goodbye_claim_at', NOW\(\)\)/.test(sql)) {
      if (busy) return { rows: [] };
      state.snapshot.goodbye_claim_at = 'now';
      return { rows: [{ phone: '0772000001', whatsapp: '256772000001', removed_at: removedAt, removal_snapshot: { ...state.snapshot } }] };
    }
    if (/SET removal_snapshot = removal_snapshot \|\| \$2::jsonb/.test(sql)) { Object.assign(state.snapshot, JSON.parse(params[1])); return { rows: [] }; }
    if (/removal_snapshot - 'goodbye_claim_at'/.test(sql)) { delete state.snapshot.goodbye_claim_at; return { rows: [] }; }
    if (/INSERT INTO audit_logs/.test(sql)) { state.audits.push(params[1]); return { rows: [] }; }
    return { rows: [] };
  };
  return { state, dbc: { query } };
}

test('a goodbye owed is delivered once: message now, film when the server has room, tried for up to two days', async () => {
  const sent = [];
  let room = false;
  const deps = {
    source: 'whatsapp_runtime',
    baseUrl: 'https://makaug.com',
    queue: async (a) => { sent.push(a); return { id: `q${sent.length}` }; },
    videos: {
      isVideoRenderingAvailable: () => true,
      goodbyeVideoUrl: () => 'https://makaug.com/api/agents/goodbye-video/x.mp4?v=1&t=abc',
      ensureGoodbyeVideo: async () => { if (!room) throw Object.assign(new Error('busy'), { code: 'VIDEO_MEMORY_GUARD' }); return 'file.mp4'; }
    }
  };
  const { state, dbc } = goodbyeDb({ reason_code: 'cancelled', goodbye: fullPayload(), goodbye_version: '1762770000000', goodbye_to: '256772000001' });
  const first = await goodbye.deliverGoodbye(AGENT_ID, { dbc, deps });
  assert.deepStrictEqual([first.message, first.film], ['sent', 'waiting']);
  assert.ok(state.snapshot.goodbye_message_at);
  assert.strictEqual(state.snapshot.goodbye_film_tries, 1);
  assert.strictEqual(state.snapshot.goodbye_claim_at, undefined, 'the claim is let go');
  room = true;
  const second = await goodbye.deliverGoodbye(AGENT_ID, { dbc, deps });
  assert.deepStrictEqual([second.message, second.film], ['already_sent', 'sent']);
  assert.ok(state.snapshot.goodbye_film_at);
  const third = await goodbye.deliverGoodbye(AGENT_ID, { dbc, deps });
  assert.deepStrictEqual([third.message, third.film], ['already_sent', 'done']);
  assert.deepStrictEqual(sent.map((m) => m.mediaType || 'text'), ['text', 'video'], 'one message, one film');
  assert.deepStrictEqual(state.audits, ['agent_goodbye_sent', 'agent_goodbye_film_sent']);

  // Two days on and still no room: stop trying.
  room = false;
  const old = goodbyeDb({ reason_code: 'cancelled', goodbye: fullPayload(), goodbye_version: '1', goodbye_to: '256772000001', goodbye_message_at: 'x', goodbye_film_tries: 200 }, { removedAt: new Date(Date.now() - 49 * 3600000).toISOString() });
  const gaveUp = await goodbye.deliverGoodbye(AGENT_ID, { dbc: old.dbc, deps });
  assert.strictEqual(gaveUp.film, 'gave_up');
  assert.ok(old.state.snapshot.goodbye_film_gave_up_at);

  // Someone else is sending it right now: leave it.
  const busy = goodbyeDb({ goodbye: fullPayload() }, { busy: true });
  assert.deepStrictEqual(await goodbye.deliverGoodbye(AGENT_ID, { dbc: busy.dbc, deps }), { skipped: 'busy_or_not_found' });
});

test('personal details: ID, NIN, expiry, email, photo and bio cleared; ID files deleted; login email and sign-up ID gone', async () => {
  const calls = [];
  const client = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/information_schema\.columns/.test(sql)) {
      return { rows: ['id', 'full_name', 'phone', 'nin', 'identity_document_url', 'identity_document_name', 'profile_photo_url', 'bio', 'email', 'user_id', 'id_expiry_date'].map((column_name) => ({ column_name })) };
    }
    if (/^SELECT nin/.test(sql.trim())) {
      return { rows: [{ nin: 'CM000', identity_document_url: 's3://private/agents/identity/id.jpg', identity_document_name: 'id.jpg', profile_photo_url: 'https://media.makaug.com/agents/george.jpg', bio: null, email: 'g@example.com', id_expiry_date: null, user_id: 'u1' }] };
    }
    if (/to_regclass\('agent_identity_files'\)/.test(sql)) return { rows: [{ ok: true }] };
    if (/DELETE FROM agent_identity_files/.test(sql)) return { rows: [{ id: 'f1' }, { id: 'f2' }] };
    if (/SELECT email, profile_data FROM users/.test(sql)) return { rows: [{ email: 'g@example.com', profile_data: { broker_identity_document_url: 's3://private/brokers/signup-identity/x.jpg', broker_national_id_number: 'CM000', audience: 'agent' } }] };
    return { rows: [] };
  } };
  const out = await goodbye.deletePersonalDetails(client, AGENT_ID);
  const update = calls.find((c) => /^UPDATE agents SET/.test(c.sql.trim()));
  assert.match(update.sql, /nin = NULL/);
  assert.match(update.sql, /id_expiry_date = NULL/);
  assert.match(update.sql, /identity_document_url = NULL/);
  assert.match(update.sql, /profile_photo_url = NULL/);
  assert.match(update.sql, /email = NULL/);
  assert.ok(!/full_name|phone/.test(update.sql.replace(/updated_at/, '')), 'name and phone are kept');
  assert.ok(!/area_certificate_url/.test(update.sql), 'a column this database does not have is not touched');
  const users = calls.find((c) => /^UPDATE users SET email = NULL/.test(c.sql.trim()));
  assert.ok(users.params[1].includes('broker_national_id_number'));
  assert.ok(!users.params[1].includes('audience'));
  assert.strictEqual(out.id_files_deleted, 2);
  assert.deepStrictEqual(out.cleared, ['NIN', 'sign-up ID photo', 'profile photo', 'email', '2 ID files', 'login email and sign-up ID']);
  assert.deepStrictEqual(out.files.map((f) => f.kind), ['id', 'photo', 'id']);
});

test('WhatsApp: the chat is marked "former agent" and reset, unless another approved record still has the number', async () => {
  const calls = [];
  const fake = (stillAgent) => ({ async query(sql, params) {
    calls.push(sql);
    if (/SELECT 1 FROM agents/.test(sql)) return { rows: stillAgent ? [{}] : [] };
    if (/UPDATE whatsapp_sessions/.test(sql)) return { rows: [{ phone: '256772000001' }] };
    if (/UPDATE whatsapp_conversation_state/.test(sql)) { assert.match(params[1], /Former agent/); return { rows: [{ phone: '256772000001' }] }; }
    return { rows: [] };
  } });
  const agent = { id: AGENT_ID, phone: '0772000001', whatsapp: '+256 772 000 001' };
  const done = await goodbye.resetFormerAgentWhatsapp({ agent, note: "Former agent: removed 2026-11-10 (They're leaving: cancelled or won't pay).", dbc: fake(false) });
  assert.deepStrictEqual(done, { sessions_reset: 1, chats_marked: 1, shared_numbers_left: 0 });
  const left = await goodbye.resetFormerAgentWhatsapp({ agent, dbc: fake(true) });
  assert.deepStrictEqual(left, { sessions_reset: 0, chats_marked: 0, shared_numbers_left: 1 });
  assert.deepStrictEqual(goodbye.phoneKeys(agent), ['772000001'], 'one number, written two ways');
});

// ---------------------------------------------------------------------------
// The King route

function routeHandler(method, routePath) {
  const layer = adminRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function stubDatabase({ reasonCode }) {
  const log = [];
  const audit = [];
  const kept = { snapshot: null };
  const agentRow = {
    id: AGENT_ID, full_name: 'George Wanyama', greeting_name: 'George', status: 'approved', removed_at: null,
    phone: '0772000001', whatsapp: '256772000001', user_id: 'u1', billing_suspended_at: null, billing_snapshot: null,
    company_name: null, makaug_agent_number: 'MKA-AG-2671940', created_at: '2026-10-23', approved_at: '2026-10-23'
  };
  const answer = (sql, params = []) => {
    log.push({ sql, params });
    if (/INSERT INTO audit_logs/.test(sql)) { audit.push({ action: params[1], details: JSON.parse(params[2]) }); return { rows: [] }; }
    if (/FROM properties p\s+WHERE p\.agent_id/.test(sql)) return { rows: [{ id: 'p1', title: 'property for rent in Mutungo', status: 'approved', approved_at: '2026-10-23' }] };
    if (/COUNT\(DISTINCT e\.country_code\)/.test(sql)) return { rows: [{ views: 21, visitors: 15, country_count: 2 }] };
    if (/GROUP BY 1\s+ORDER BY 2 DESC, 1/.test(sql)) return { rows: [{ code: 'UG', visitors: 12 }, { code: 'GB', visitors: 3 }] };
    if (/GROUP BY 1/.test(sql)) return { rows: [{ id: 'p1', views: 21, visitors: 15 }] };
    if (/FROM leads l/.test(sql)) return { rows: [{ enquiries: 1, whatsapp_clicks: 0 }] };
    if (/UPDATE properties p SET status = 'hidden'/.test(sql)) {
      assert.match(sql, /broker_agent_id/, 'listings posted for them as the broker come down too');
      return { rows: [{ id: 'p1', previous_status: 'approved' }] };
    }
    if (/information_schema\.columns/.test(sql)) return { rows: ['nin', 'email', 'profile_photo_url', 'user_id'].map((column_name) => ({ column_name })) };
    if (/^SELECT nin/.test(sql.trim())) return { rows: [{ nin: 'CM000', email: null, profile_photo_url: null, user_id: 'u1' }] };
    if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
    if (/DELETE FROM agent_identity_files/.test(sql)) return { rows: [{ id: 'f1' }] };
    if (/SELECT email, profile_data FROM users/.test(sql)) return { rows: [{ email: null, profile_data: {} }] };
    if (/UPDATE users SET status = 'suspended'/.test(sql)) return { rows: [{ id: 'u1' }] };
    if (/SET removed_at = NOW\(\)/.test(sql)) { kept.snapshot = JSON.parse(params[3]); return { rows: [{ removed_at: new Date().toISOString() }] }; }
    if (/jsonb_build_object\('goodbye_claim_at', NOW\(\)\)/.test(sql)) {
      return kept.snapshot ? { rows: [{ phone: agentRow.phone, whatsapp: agentRow.whatsapp, removed_at: new Date().toISOString(), removal_snapshot: { ...kept.snapshot } }] } : { rows: [] };
    }
    if (/SET removal_snapshot = removal_snapshot \|\| \$2::jsonb/.test(sql)) { Object.assign(kept.snapshot, JSON.parse(params[1])); return { rows: [] }; }
    if (/SELECT 1 FROM agents/.test(sql)) return { rows: [] };
    if (/FROM agents WHERE id = \$1/.test(sql)) return { rows: [agentRow] };
    return { rows: [] };
  };
  const originals = { query: db.query, getClient: db.getClient };
  db.query = async (sql, params) => answer(sql, params);
  db.getClient = async () => ({ query: async (sql, params) => answer(sql, params), release() {} });
  const restore = () => { db.query = originals.query; db.getClient = originals.getClient; };
  return { log, audit, restore, reasonCode };
}

test('King: "They cancelled" hides listings, closes the login, resets WhatsApp, sends the goodbye and keeps their details for 30 days', async (t) => {
  const stub = stubDatabase({ reasonCode: 'cancelled' });
  const originalVideos = { ...videos };
  videos.isVideoRenderingAvailable = () => true;
  videos.ensureGoodbyeVideo = async () => '/tmp/film.mp4';
  t.after(() => { stub.restore(); Object.assign(videos, originalVideos); });
  queued.length = 0;
  const res = fakeRes();
  await routeHandler('post', '/agents/:id/remove')({ params: { id: AGENT_ID }, body: { reason_code: 'cancelled', reason: 'moving to Nairobi' }, adminAuth: { userId: 'staff-1' } }, res, (e) => { throw e; });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.strictEqual(d.reason_code, 'cancelled');
  assert.strictEqual(d.listings_hidden, 1);
  assert.strictEqual(d.login_closed, true);
  assert.strictEqual(d.personal_deleted, undefined, 'nothing is deleted at removal');
  const days = (Date.parse(d.personal_delete_after) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, `deleted in 30 days, got ${days}`);
  assert.ok(!stub.log.some((c) => /SET nin = NULL|DELETE FROM agent_identity_files|UPDATE users SET email = NULL/.test(c.sql)), 'their details stay for now');
  assert.strictEqual(d.whatsapp.chats_marked, 0);
  assert.deepStrictEqual(d.goodbye, { status: 'sending', to: '…0001' });
  const snapshotSql = stub.log.find((c) => /SET removed_at = NOW\(\)/.test(c.sql));
  assert.strictEqual(snapshotSql.params[1], "They're leaving: cancelled or won't pay — moving to Nairobi");
  const snap = JSON.parse(snapshotSql.params[3]);
  assert.strictEqual(snap.reason_code, 'cancelled');
  assert.strictEqual(snap.login_closed, true);
  assert.strictEqual(snap.whatsapp_reset, true);
  assert.strictEqual(snap.personal_delete_after, d.personal_delete_after);
  assert.strictEqual(snap.goodbye.agent.greeting_name, 'George', 'the film can still be made after the details are gone');
  assert.ok(!JSON.stringify(snap.goodbye).includes('0772000001'), 'the kept goodbye holds no phone number');
  assert.strictEqual(snap.goodbye_to, '256772000001');
  assert.match(snap.goodbye_version, /^\d{13}$/);
  // Order: everything committed before anything is sent.
  const commitAt = stub.log.findIndex((c) => c.sql === 'COMMIT');
  const sessionAt = stub.log.findIndex((c) => /UPDATE whatsapp_sessions/.test(c.sql));
  assert.ok(commitAt > 0 && sessionAt > commitAt);
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(queued.length, 2, 'the message, then the film');
  assert.match(queued[0].text, /^Hi George,/);
  assert.match(queued[0].text, /Your goodbye film is below\./, 'the film could be made, so the message says so');
  assert.match(queued[0].text, /WhatsApp makaug on \+256 780 863 394/);
  assert.strictEqual(queued[0].recipient, '256772000001');
  assert.strictEqual(queued[1].mediaType, 'video');
  assert.match(queued[1].mediaUrl, /\/api\/agents\/goodbye-video\/e1d9a5f5-ce49-4e9d-a9ca-1cad1c78d3ef\.mp4\?v=\d+&t=/);
  assert.deepStrictEqual(stub.audit.map((a) => a.action), ['admin_agent_removed', 'agent_goodbye_sent']);
});

test('King: "Duplicate or test record" sends nothing and deletes nothing', async (t) => {
  const stub = stubDatabase({ reasonCode: 'duplicate' });
  t.after(() => stub.restore());
  queued.length = 0;
  const res = fakeRes();
  await routeHandler('post', '/agents/:id/remove')({ params: { id: AGENT_ID }, body: { reason_code: 'duplicate' }, adminAuth: { userId: 'staff-1' } }, res, (e) => { throw e; });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.login_closed, false);
  assert.strictEqual(res.body.data.personal_delete_after, null, 'nothing is ever deleted for a duplicate');
  assert.strictEqual(res.body.data.goodbye, undefined);
  assert.ok(!stub.log.some((c) => /UPDATE users|DELETE FROM agent_identity_files|whatsapp_sessions/.test(c.sql)));
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(queued.length, 0);
});

test('King: a reason is required; "Something else" needs a note; an old caller with only a typed reason still works', async (t) => {
  const stub = stubDatabase({ reasonCode: 'other' });
  t.after(() => stub.restore());
  const handler = routeHandler('post', '/agents/:id/remove');
  const none = fakeRes();
  await handler({ params: { id: AGENT_ID }, body: {} }, none, (e) => { throw e; });
  assert.strictEqual(none.statusCode, 400);
  const other = fakeRes();
  await handler({ params: { id: AGENT_ID }, body: { reason_code: 'other' } }, other, (e) => { throw e; });
  assert.strictEqual(other.statusCode, 400);
  const legacy = fakeRes();
  await handler({ params: { id: AGENT_ID }, body: { reason: 'duplicate of another record' } }, legacy, (e) => { throw e; });
  assert.strictEqual(legacy.statusCode, 200);
  assert.strictEqual(legacy.body.data.reason_code, 'other');
});

test('King preview shows what happens and the exact goodbye, and changes nothing', async (t) => {
  const stub = stubDatabase({ reasonCode: 'cancelled' });
  const originalAvailable = videos.isVideoRenderingAvailable;
  videos.isVideoRenderingAvailable = () => true;
  t.after(() => { stub.restore(); videos.isVideoRenderingAvailable = originalAvailable; });
  const res = fakeRes();
  await routeHandler('get', '/agents/:id/remove-preview')({ params: { id: AGENT_ID }, query: { reason_code: 'cancelled' } }, res, (e) => { throw e; });
  const d = res.body.data;
  assert.strictEqual(d.reason, 'cancelled');
  assert.strictEqual(d.reasons.length, 5);
  assert.match(d.goodbye.message, /^Hi George,/);
  assert.strictEqual(d.goodbye.to, '…0001');
  assert.match(d.goodbye.film_url, /goodbye-video\/.+\.mp4\?v=p\d{8}&t=/);
  assert.ok(!stub.log.some((c) => /^\s*(UPDATE|DELETE|INSERT)/.test(c.sql)), 'a preview writes nothing');
});

test('Restore reopens the login, unmarks the chat and says which deleted details to ask for again', async (t) => {
  const log = [];
  const originals = { query: db.query, getClient: db.getClient };
  const answer = async (sql, params) => {
    log.push({ sql, params });
    if (/SELECT id, full_name, phone, whatsapp, user_id, removed_at, removal_snapshot FROM agents/.test(sql)) {
      return { rows: [{ id: AGENT_ID, full_name: 'George Wanyama', phone: '0772000001', whatsapp: null, user_id: 'u1', removed_at: '2026-11-10', removal_snapshot: { previous_status: 'approved', listings: [{ id: 'p1', previous_status: 'approved' }], login_closed: true, whatsapp_reset: true, personal_deleted: ['NIN', 'email'] } }] };
    }
    if (/UPDATE users SET status = 'active'/.test(sql)) return { rows: [{ id: 'u1' }] };
    if (/SELECT 1 FROM agents/.test(sql)) return { rows: [] };
    return { rows: [] };
  };
  db.query = answer;
  db.getClient = async () => ({ query: answer, release() {} });
  t.after(() => { db.query = originals.query; db.getClient = originals.getClient; });
  const res = fakeRes();
  await routeHandler('post', '/agents/:id/restore')({ params: { id: AGENT_ID }, adminAuth: { userId: 'staff-1' } }, res, (e) => { throw e; });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.login_reopened, true);
  assert.deepStrictEqual(res.body.data.details_to_ask_again, ['NIN', 'email']);
  assert.ok(log.some((c) => /UPDATE properties SET status = \$2/.test(c.sql)));
  assert.ok(log.some((c) => /whatsapp_conversation_state SET tags = COALESCE\(tags, '\[\]'::jsonb\) - 'former agent'/.test(c.sql)));
});

test('King shows the reasons, the preview and a test send; the bundles are rebuilt', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets/makaug-app.js'), 'utf8');
  assert.match(app, /const ADMIN_AGENT_REMOVAL_REASONS = \[/);
  for (const code of ['cancelled', 'not_paying', 'rules', 'duplicate', 'other']) assert.match(app, new RegExp(`code: "${code}"`));
  assert.match(app, /\/remove-preview\?reason_code=/);
  assert.match(app, /\/goodbye-preview`/);
  assert.match(app, /body: \{ reason_code: code, reason: note \}/);
  const admin = fs.readFileSync(path.join(__dirname, '..', 'assets/build/makaug-admin.min.js'), 'utf8');
  assert.match(admin, /remove-preview/);
});

test('a payment does not put a removed agent back live; Restore in King comes first', async () => {
  const billing = require('../services/billingOpsService');
  const writes = [];
  const fake = { async query(sql) {
    if (/FROM agents WHERE id = \$1::uuid/.test(sql)) return { rows: [{ id: AGENT_ID, billing_suspended_at: '2026-11-01', billing_snapshot: { previous_status: 'approved', listings: [{ id: 'p1', previous_status: 'approved' }] }, removed_at: '2026-11-10' }] };
    writes.push(sql);
    return { rows: [] };
  }, async getClient() { return { query: async (sql) => { writes.push(sql); return { rows: [] }; }, release() {} }; } };
  const out = await billing.reinstateAgentAfterPayment(fake, { agentId: AGENT_ID, notify: false });
  assert.deepStrictEqual(out, { reinstated: false, reason: 'removed' });
  assert.ok(!writes.some((sql) => /UPDATE (properties|agents)/.test(sql)));
});

test('King: removing an agent twice is refused, sends nothing, and gives the database connection back', async (t) => {
  const originals = { query: db.query, getClient: db.getClient };
  let released = 0;
  const answer = async (sql) => {
    if (/FROM agents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ id: AGENT_ID, full_name: 'George Wanyama', removed_at: '2026-11-09' }] };
    if (/FROM agents WHERE id = \$1/.test(sql)) return { rows: [{ id: AGENT_ID, full_name: 'George Wanyama' }] };
    return { rows: [] };
  };
  db.query = answer;
  db.getClient = async () => ({ query: answer, release() { released += 1; } });
  t.after(() => { db.query = originals.query; db.getClient = originals.getClient; });
  queued.length = 0;
  const res = fakeRes();
  await routeHandler('post', '/agents/:id/remove')({ params: { id: AGENT_ID }, body: { reason_code: 'cancelled' } }, res, (e) => { throw e; });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(released, 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(queued.length, 0);
});


test('30 days later the details of an agent who cancelled are deleted, name and number kept; a restored agent is left alone', async () => {
  const calls = [];
  const audits = [];
  const rows = {
    'a-due': { id: 'a-due', removed_at: '2026-10-01', removal_snapshot: { reason_code: 'cancelled', personal_delete_after: '2026-10-31T00:00:00Z' } },
    'a-restored': { id: 'a-restored', removed_at: null, removal_snapshot: null }
  };
  const answer = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/SELECT id FROM agents\s+WHERE removed_at IS NOT NULL/.test(sql)) {
      assert.match(sql, /removal_snapshot->>'reason_code' = 'cancelled'/);
      assert.match(sql, /removal_snapshot->>'personal_deleted_at' IS NULL/);
      return { rows: [{ id: 'a-due' }, { id: 'a-restored' }] };
    }
    if (/SELECT id, removed_at, removal_snapshot FROM agents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [rows[params[0]]] };
    if (/information_schema\.columns/.test(sql)) return { rows: ['nin', 'email', 'phone', 'full_name', 'user_id'].map((column_name) => ({ column_name })) };
    if (/^SELECT nin/.test(sql.trim())) return { rows: [{ nin: 'CM000', email: 'g@example.com', user_id: null }] };
    if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
    if (/DELETE FROM agent_identity_files/.test(sql)) return { rows: [{ id: 'f1' }] };
    if (/INSERT INTO audit_logs/.test(sql)) { audits.push(JSON.parse(params[0])); return { rows: [] }; }
    return { rows: [] };
  };
  const fake = { query: answer, async getClient() { return { query: answer, release() {} }; } };
  const out = await goodbye.runFormerAgentDetailDeletion(fake, { now: new Date('2026-11-10T12:00:00Z'), logger: { warn() {}, info() {} } });
  assert.strictEqual(out.checked, 2);
  assert.deepStrictEqual(out.deleted, [{ id: 'a-due', deleted: ['NIN', 'email', '1 ID file'] }]);
  const update = calls.find((c) => /^UPDATE agents SET nin = NULL/.test(c.sql.trim()));
  assert.ok(update && !/phone|full_name/.test(update.sql), 'name and number are kept');
  const marked = calls.find((c) => /removal_snapshot = COALESCE\(removal_snapshot, '\{\}'::jsonb\) \|\| \$2::jsonb/.test(c.sql));
  assert.deepStrictEqual(JSON.parse(marked.params[1]), { personal_deleted: ['NIN', 'email', '1 ID file'], personal_deleted_at: '2026-11-10T12:00:00.000Z' });
  assert.deepStrictEqual(audits, [{ agent_id: 'a-due', deleted: ['NIN', 'email', '1 ID file'] }]);
  assert.strictEqual(calls.filter((c) => /^UPDATE agents SET nin = NULL/.test(c.sql.trim())).length, 1, 'the restored agent was not touched');
});


test('Arthur and Ronald are told about every removal, and only they are', async () => {
  assert.deepStrictEqual(goodbye.removalAlertRecipients({}), ['+447757773202', '+256709402189']);
  assert.deepStrictEqual(goodbye.removalAlertRecipients({ AGENT_HELP_CONTACT_PHONE: '+256 709 402 189' }), ['+447757773202', '+256 709 402 189']);
  assert.deepStrictEqual(goodbye.removalAlertRecipients({ AGENT_REMOVED_ALERT_WHATSAPP: '+447757773202, 0772000001, +256772000001' }), ['+447757773202', '0772000001']);

  const agent = { id: AGENT_ID, full_name: 'George Wanyama', makaug_agent_number: 'MKA-AG-2671940', phone: '0772000001', whatsapp: '256772000001' };
  const leaving = goodbye.buildRemovalAlert({
    agent, reason: goodbye.removalReason('cancelled'), reasonText: "They're leaving: cancelled or won't pay — moving to Nairobi", by: 'Ronald Okongo',
    listingsHidden: 3, loginClosed: true, goodbye: { status: 'sending', to: '…0001' }, personalDeleteAfter: '2026-12-10T12:00:00Z', baseUrl: 'https://makaug.com'
  });
  assert.strictEqual(leaving, [
    '🚪 *Agent removed: George Wanyama*',
    'Agent No MKA-AG-2671940 · 0772 000 001',
    "Why: They're leaving: cancelled or won't pay — moving to Nairobi",
    'By: Ronald Okongo',
    '• 3 listings taken off makaug, login closed',
    '• Goodbye message and film on their way to them on WhatsApp',
    '• Their ID and personal details are deleted on 10 Dec 2026 unless they are restored before then',
    'To undo: King → Agents → George Wanyama → Restore agent (https://makaug.com/admin)'
  ].join('\n'));
  const dupe = goodbye.buildRemovalAlert({ agent, reason: goodbye.removalReason('duplicate'), reasonText: 'Duplicate or test record', listingsHidden: 0 });
  assert.match(dupe, /• No live listings to take down\n• Nothing was sent to them, and their details are kept/);

  const sent = [];
  const logged = [];
  const fakeDb = { async query(sql, params) { if (/INSERT INTO notifications/.test(sql)) logged.push(params); return { rows: [{ id: 'n1' }] }; } };
  const results = await realAlertRemoval({ agent, reason: goodbye.removalReason('rules'), reasonText: 'Broke the rules (fake or wrong listings)', listingsHidden: 2, loginClosed: true }, {
    dbc: fakeDb,
    deliver: async (msg) => { sent.push(msg); return { status: 'queued' }; }
  });
  assert.deepStrictEqual(sent.map((m) => m.to), ['+447757773202', '+256709402189'], 'Arthur and Ronald, nobody else');
  assert.ok(sent.every((m) => m.kind === 'agent_removed' && /Agent removed: George Wanyama/.test(m.body)));
  assert.deepStrictEqual(results.map((r) => r.status), ['queued', 'queued']);
  assert.strictEqual(logged.length, 1);
});

test('King: every removal tells Arthur and Ronald, after it is saved', async (t) => {
  const stub = stubDatabase({ reasonCode: 'duplicate' });
  const original = goodbye.alertRemoval;
  const alerts = [];
  goodbye.alertRemoval = async (details) => { alerts.push(details); return []; };
  t.after(() => { stub.restore(); goodbye.alertRemoval = original; });
  const res = fakeRes();
  await routeHandler('post', '/agents/:id/remove')({ params: { id: AGENT_ID }, body: { reason_code: 'duplicate', reason: 'second record' }, adminAuth: { userId: 'staff-1' } }, res, (e) => { throw e; });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.team_notified, true);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].agent.full_name, 'George Wanyama');
  assert.strictEqual(alerts[0].reason.code, 'duplicate');
  assert.strictEqual(alerts[0].reasonText, 'Duplicate or test record — second record');
  assert.strictEqual(alerts[0].listingsHidden, 1);
});
