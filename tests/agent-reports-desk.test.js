'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const reports = require('../services/agentWeeklyReportService');
const filter = require('../services/analyticsEventFilter');

const sample = {
  id: 'r1',
  agent: { id: 'a1', full_name: 'Francis Isabirye', company_name: 'Isabirye Agency', makaug_agent_number: 'MKA-AG-6835341', whatsapp: '256700000000' },
  week_start: '2026-11-02',
  week_end: '2026-11-08',
  metrics: { views: 75, visitors: 73, enquiries: 0, whatsapp_clicks: 0, saves: 0, active_listings: 372 },
  previous_metrics: { views: 128, visitors: 110, enquiries: 0, whatsapp_clicks: 0, saves: 0 },
  top_listings: [
    { id: '11111111-1111-1111-1111-111111111111', title: 'Land in Ntinda, Nakawa, Central', url: 'https://makaug.com/property/11111111-1111-1111-1111-111111111111', views: 20, enquiries: 0, image_count: 3 }
  ],
  top_countries: [
    { code: 'SG', name: 'Singapore', visitors: 29 },
    { code: 'CN', name: 'China', visitors: 15 },
    { code: 'UG', name: 'Uganda', visitors: 4 }
  ],
  extras: {
    rank: { position: 1, total: 11 },
    busiest_day: { day: 'Tuesday', views: 20 },
    peak_hour: { label: '2pm–4pm', views: 18 }
  }
};

test('listing views exclude staff, owner previews and obvious bots, but keep legacy unflagged events', () => {
  assert.equal(filter.isCountableListingView({}), true, 'legacy events with no flags still count');
  assert.equal(filter.isCountableListingView({ viewer_kind: 'public' }), true);
  assert.equal(filter.isCountableListingView({ viewer_kind: 'staff' }), false);
  assert.equal(filter.isCountableListingView({ viewer_kind: 'owner_preview' }), false);
  assert.equal(filter.isCountableListingView({ is_bot: true }), false);
  assert.equal(filter.isCountableListingView({ is_bot: 'true', viewer_kind: 'public' }), false);
  assert.match(filter.countableListingViewSql('e'), /viewer_kind/);
  assert.match(filter.countableListingViewSql('e'), /is_bot/);
  const service = fs.readFileSync('services/agentWeeklyReportService.js', 'utf8');
  assert.match(service, /propertyOpenMatchSql\('e', 1, 2, 3\)/);
  assert.match(service, /countableListingViewSql\('e'\)/);
});

test('bot detection uses the user-agent and Cloudflare signals, not WhatsApp in-app browsers', () => {
  assert.equal(filter.isLikelyBotUserAgent('Mozilla/5.0 (Linux; Android 13) WhatsApp/2.24.20.0'), false);
  assert.equal(filter.isLikelyBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'), false);
  assert.equal(filter.isLikelyBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(filter.isLikelyBotUserAgent('facebookexternalhit/1.1'), true);
  const req = (headers) => ({ get: (name) => headers[name.toLowerCase()] });
  assert.equal(filter.isLikelyBotRequest(req({ 'user-agent': 'curl/8.0' })), true);
  assert.equal(filter.isLikelyBotRequest(req({ 'cf-bot-score': '5', 'user-agent': 'Mozilla/5.0' })), true);
  assert.equal(filter.isLikelyBotRequest(req({ 'cf-bot-score': '95', 'user-agent': 'Mozilla/5.0' })), false);
  const annotated = filter.annotateEventPayload({ viewer_kind: 'staff', property_id: 'p1' }, req({ 'user-agent': 'Mozilla/5.0' }));
  assert.equal(annotated.viewer_kind, 'staff');
  assert.equal(annotated.is_bot, undefined);
  const bot = filter.annotateEventPayload({ viewer_kind: 'public' }, req({ 'user-agent': 'Bytespider' }));
  assert.equal(bot.is_bot, true);
});

test('manual social views are cleaned, survive a numbers refresh, and appear on the caption', () => {
  assert.deepEqual(reports.cleanSocialViews({ facebook: '12', instagram: 0, tiktok: 8, junk: 9, youtube: 'nope' }), { facebook: 12, tiktok: 8 });
  assert.equal(reports.socialViewsTotal({ facebook: 12, tiktok: 8 }), 20);
  const merged = reports.mergeReportExtras({ rank: { position: 1, total: 11 }, traffic_sources: [] }, { social_views: { facebook: 40, instagram: 15 } });
  assert.equal(merged.rank.position, 1);
  assert.deepEqual(merged.social_views, { facebook: 40, instagram: 15 });
  const without = reports.mergeReportExtras({ busiest_day: { day: 'Tuesday' } }, {});
  assert.equal(without.social_views, undefined);
  const caption = reports.buildWhatsAppCardCaption({
    ...sample,
    extras: { ...sample.extras, social_views: { facebook: 40, instagram: 15, whatsapp_status: 9 } }
  });
  assert.match(caption, /Social media views: Facebook 40 · Instagram 15 · WhatsApp status 9/);
  const message = reports.buildWhatsAppReportMessage({
    ...sample,
    extras: { ...sample.extras, social_views: { tiktok: 200 } }
  });
  assert.match(message, /Social media views \(entered by makaug\): \*TikTok 200\*/);
});

test('saving social views writes them into report extras and does not invent other fields', async () => {
  const db = require('../config/database');
  const original = db.query;
  const calls = [];
  const current = {
    id: 'r1',
    metrics: { views: 10, visitors: 8, enquiries: 0, whatsapp_clicks: 0, saves: 0, active_listings: 2 },
    previous_metrics: {},
    top_listings: [],
    top_countries: [],
    insights: [],
    next_steps: [],
    extras: { rank: { position: 2, total: 11 } },
    status: 'draft'
  };
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT r\.\*/.test(sql) || /FROM agent_weekly_reports/.test(sql)) {
      return { rows: [{ ...current, agent_id: 'a1', makaug_agent_number: 'MKA-AG-1', full_name: 'Francis', week_start: '2026-11-02', week_end: '2026-11-08' }] };
    }
    if (/UPDATE agent_weekly_reports SET/.test(sql)) {
      current.extras = JSON.parse(params[9]);
      current.status = params[7];
      return { rows: [] };
    }
    return { rows: [] };
  };
  try {
    const saved = await reports.updateReport('r1', { social_views: { facebook: '25', instagram: 10, tiktok: '' } }, 'staff');
    const update = calls.find((c) => /UPDATE agent_weekly_reports SET/.test(c.sql));
    assert.ok(update, 'the report extras were saved');
    assert.match(update.sql, /extras = \$10/);
    assert.deepEqual(JSON.parse(update.params[9]).social_views, { facebook: 25, instagram: 10 });
    assert.deepEqual(JSON.parse(update.params[9]).rank, { position: 2, total: 11 });
    assert.deepEqual(saved.social_views, { facebook: 25, instagram: 10 });
  } finally {
    db.query = original;
  }
});

test('bulk send only queues approved reports, stays staff-initiated, and never sends WhatsApp from the test', () => {
  const prepared = reports.prepareBulkReportSends([
    { id: 'draft', status: 'draft', agent: { full_name: 'A', whatsapp: '256700000001' } },
    { id: 'ok', status: 'approved', agent: { full_name: 'B', whatsapp: '256700000002' } },
    { id: 'sent', status: 'sent', agent: { full_name: 'C', phone: '256700000003' } },
    { id: 'nophone', status: 'approved', agent: { full_name: 'D', whatsapp: '' } },
    null
  ]);
  assert.equal(prepared[0].ok, false);
  assert.match(prepared[0].error, /Approve the report/);
  assert.equal(prepared[1].ok, true);
  assert.equal(prepared[1].to, '256700000002');
  assert.equal(prepared[2].ok, true);
  assert.equal(prepared[2].to, '256700000003');
  assert.equal(prepared[3].ok, false);
  assert.match(prepared[3].error, /No WhatsApp number/);
  assert.equal(prepared[4].ok, false);

  const admin = fs.readFileSync('routes/admin.js', 'utf8');
  assert.match(admin, /router\.post\('\/agent-reports\/bulk-send'/);
  assert.match(admin, /confirm !== true/);
  assert.match(admin, /Pick at least one report/);
  assert.doesNotMatch(admin, /agent-reports\/bulk-send[\s\S]{0,400}setInterval/);
  assert.ok(admin.indexOf("router.post('/agent-reports/bulk-send'") < admin.indexOf("router.post('/agent-reports/:id/send'"));
  const app = fs.readFileSync('assets/makaug-app.js', 'utf8');
  assert.match(app, /async function sendAdminAgentReportsBulk/);
  assert.match(app, /window\.confirm\(`Send weekly reports to/);
  assert.match(app, /confirm: true/);
  assert.match(app, /admin-agent-report-select/);
});

test('on-screen preview is visible and the WhatsApp preview payload still has the caption and card', () => {
  const built = reports.buildInsights({
    metrics: sample.metrics,
    previous: sample.previous_metrics,
    topListings: sample.top_listings,
    topCountries: sample.top_countries,
    activeListings: sample.metrics.active_listings,
    extras: sample.extras
  });
  const caption = reports.buildWhatsAppCardCaption({ ...sample, insights: built.insights, next_steps: built.nextSteps });
  assert.match(caption, /Hi Francis, your makaug weekly report is here/);
  assert.match(caption, /75 views · 73 visitors · 0 enquiries/);
  assert.match(caption, /Rank #1 of 11/);
  assert.match(caption, /This week, try:/);
  assert.match(caption, /Check your prices/);
  const app = fs.readFileSync('assets/makaug-app.js', 'utf8');
  assert.match(app, /id="admin-agent-report-onscreen-preview"/);
  assert.match(app, /On-screen preview/);
  assert.match(app, /You can read it here without sending a WhatsApp/);
  assert.match(app, /renderAgentReportBody\(r\)/);
  assert.match(app, /onclick="sendAdminAgentReport\(true\)"/);
  assert.match(app, /ar-social-\$\{key\}/);
  assert.match(app, /AGENT_REPORT_SOCIAL_CHANNELS/);
  assert.match(app, /viewer_kind: isAdminViewer \? "staff"/);
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /Send selected/);
  assert.match(html, /id="admin-agent-report-select-all"/);
  assert.match(html, /id="admin-agent-report-bulk-progress"/);
  const analytics = fs.readFileSync('routes/analytics.js', 'utf8');
  assert.match(analytics, /annotateEventPayload\(params, req\)/);
});

test('advice for views with no enquiries and mostly overseas datacentre traffic is specific, not a generic diaspora tip', () => {
  const { insights, nextSteps } = reports.buildInsights({
    metrics: sample.metrics,
    previous: sample.previous_metrics,
    topListings: sample.top_listings,
    topCountries: sample.top_countries,
    activeListings: 372,
    extras: sample.extras
  });
  const insightText = insights.join('\n');
  const stepText = nextSteps.join('\n');
  assert.match(insightText, /none got in touch|but none got in touch/);
  assert.match(insightText, /Singapore|automated traffic/);
  assert.match(stepText, /Check your prices/);
  assert.match(stepText, /2pm–4pm/);
  assert.match(stepText, /Tuesday/);
  assert.doesNotMatch(stepText, /buyers abroad can view without travelling/);
  const withSocial = reports.buildInsights({
    metrics: sample.metrics,
    previous: sample.previous_metrics,
    topListings: sample.top_listings,
    topCountries: [{ code: 'UG', name: 'Uganda', visitors: 70 }],
    activeListings: 10,
    extras: { ...sample.extras, social_views: { facebook: 80, instagram: 20 } }
  });
  assert.ok(withSocial.insights.some((line) => /Social posts you tracked had 100 views/.test(line)));
  assert.ok(withSocial.nextSteps.some((line) => /social posts are being seen/i.test(line)));
});

test('real overseas buyers still get the walk-through tip, and empty weeks stay clear', () => {
  const { insights, nextSteps } = reports.buildInsights({
    metrics: { views: 120, visitors: 80, enquiries: 4, whatsapp_clicks: 6, saves: 3 },
    previous: { views: 100, visitors: 70, enquiries: 2, whatsapp_clicks: 3, saves: 1 },
    topListings: [{ title: 'A', views: 80, enquiries: 0, image_count: 2 }],
    topCountries: [{ code: 'UG', name: 'Uganda', visitors: 60 }, { code: 'GB', name: 'United Kingdom', visitors: 20 }],
    activeListings: 7
  });
  assert.ok(insights.some((line) => /outside Uganda/.test(line)));
  assert.ok(nextSteps.some((line) => /buyers abroad can view without travelling/.test(line)));
  const empty = reports.buildInsights({ metrics: {}, previous: {}, topListings: [], topCountries: [], activeListings: 0 });
  assert.match(empty.insights[0], /No one opened/);
  assert.match(empty.nextSteps[0], /no live listings/);
});
