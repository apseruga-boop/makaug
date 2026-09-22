'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const express = require('express');
const request = require('supertest');

const reports = require('../services/agentWeeklyReportService');
const { resolveVisitorCountry, countryName } = require('../services/visitorCountryService');

const sampleReport = {
  id: 'r1',
  agent: { id: 'a1', full_name: 'Francis Okello', company_name: 'Okello Homes', makaug_agent_number: 'MKA-AG-1234567', whatsapp: '256700000000' },
  week_start: '2026-09-14',
  week_end: '2026-09-20',
  metrics: { views: 120, visitors: 80, enquiries: 4, whatsapp_clicks: 6, saves: 3, active_listings: 7 },
  previous_metrics: { views: 100, visitors: 70, enquiries: 2, whatsapp_clicks: 3, saves: 1 },
  top_listings: [
    { id: '11111111-1111-1111-1111-111111111111', title: '3-bed house', area: 'Muyenga', url: 'https://makaug.com/property/11111111-1111-1111-1111-111111111111', views: 60, enquiries: 5 }
  ],
  top_countries: [{ code: 'UG', name: 'Uganda', visitors: 60 }, { code: 'GB', name: 'United Kingdom', visitors: 20 }],
  insights: ['Views up 20%.'],
  next_steps: ['Boost the Muyenga house.']
};

test('report weeks run Monday to Sunday and default to the last completed week', () => {
  const week = reports.resolveReportWeek('', new Date('2026-09-22T09:00:00Z'));
  assert.equal(week.weekStart, '2026-09-14');
  assert.equal(week.weekEnd, '2026-09-20');
  assert.equal(week.startsAt, '2026-09-14T00:00:00+03:00');
  assert.equal(week.endsBefore, '2026-09-21T00:00:00+03:00');
  assert.equal(week.previousStartsAt, '2026-09-07T00:00:00+03:00');
  assert.equal(reports.resolveReportWeek('2026-09-17').weekStart, '2026-09-14', 'mid-week dates snap to Monday');
});

test('percent change handles an empty prior week', () => {
  assert.equal(reports.percentChange(120, 100), 20);
  assert.equal(reports.percentChange(5, 0), null);
});

test('WhatsApp message carries agent ID, property links and the logged-in report link', () => {
  const text = reports.buildWhatsAppReportMessage(sampleReport);
  assert.match(text, /Agent ID: \*MKA-AG-1234567\*/);
  assert.match(text, /https:\/\/makaug\.com\/property\/11111111-1111-1111-1111-111111111111/);
  assert.match(text, /makaug\.com\/broker-dashboard#broker-report-panel/);
  assert.match(text, /log in to your makaug broker account/);
  assert.match(text, /United Kingdom — 20 visitors/);
  assert.match(text, /Listing views: \*120\* \(\+20%\)/);
  const dup = reports.buildWhatsAppReportMessage({ ...sampleReport, agent: { ...sampleReport.agent, company_name: 'Francis Okello' }, top_listings: [{ title: 'Land for sale in Kira', area: 'Kira, Wakiso', url: 'https://makaug.com/property/x', views: 4, enquiries: 0 }] });
  assert.match(dup, /Agent: \*Francis Okello\*\n/);
  assert.match(dup, /1\. Land for sale in Kira — 4 views/);
});

test('insights call out foreign visitors and a dominant listing', () => {
  const { insights, nextSteps } = reports.buildInsights({
    metrics: sampleReport.metrics,
    previous: sampleReport.previous_metrics,
    topListings: [
      { title: 'A', views: 80, enquiries: 0, image_count: 2 },
      { title: 'B', views: 20, enquiries: 1, image_count: 8 }
    ],
    topCountries: sampleReport.top_countries,
    activeListings: 7
  });
  assert.ok(insights.some((line) => /outside Uganda/.test(line)));
  assert.ok(insights.some((line) => /Views up 20%/.test(line)));
  assert.ok(nextSteps.some((line) => /Add more photos to "A"/.test(line)));
});

test('listings without photos get a next step', () => {
  const { nextSteps } = reports.buildInsights({
    metrics: { views: 30, visitors: 25 }, previous: { views: 28, visitors: 10 },
    topListings: [{ title: 'Plot in Kira', views: 4, enquiries: 0, image_count: 0 }, { title: 'House', views: 3, enquiries: 0, image_count: 4 }],
    topCountries: [], activeListings: 5
  });
  assert.ok(nextSteps.some((line) => /Add photos to "Plot in Kira"/.test(line)));
  assert.equal(typeof reports.ensureAgentNumber, 'function');
  assert.equal(typeof require('../services/authFlowService').generateMakaugAgentNumber, 'function');
});

test('an agent with no activity gets a clear next step', () => {
  const { insights, nextSteps } = reports.buildInsights({ metrics: {}, previous: {}, topListings: [], topCountries: [], activeListings: 0 });
  assert.match(insights[0], /No one opened/);
  assert.match(nextSteps[0], /no live listings/);
});

test('edited listing links must be https, otherwise fall back to the makaug property page', () => {
  const [listing] = reports.cleanListings([{ id: 'abc', title: 'Plot', url: 'javascript:alert(1)' }]);
  assert.equal(listing.url, 'https://makaug.com/property/abc');
});

test('visitor country prefers the edge header, then the browser time zone', () => {
  const req = (headers) => ({ get: (name) => headers[name.toLowerCase()] });
  assert.equal(resolveVisitorCountry(req({ 'cf-ipcountry': 'gb' }), { visitor_timezone: 'Africa/Kampala' }), 'GB');
  assert.equal(resolveVisitorCountry(req({ 'cf-ipcountry': 'XX' }), { visitor_timezone: 'Asia/Dubai' }), 'AE');
  assert.equal(resolveVisitorCountry(req({}), { visitor_timezone: 'Mars/Base' }), '');
  assert.equal(countryName('UG'), 'Uganda');
});

test('broker weekly report API requires a signed-in broker', async () => {
  const app = express();
  app.use('/api/agents', require('../routes/agents'));
  const res = await request(app).get('/api/agents/me/weekly-report');
  assert.equal(res.status, 401);
});

test('admin agent report API is behind admin auth', async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'test-admin-key';
  try {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', require('../routes/admin'));
    const res = await request(app).get('/api/admin/agent-reports');
    assert.ok([401, 403].includes(res.status), `expected auth failure, got ${res.status}`);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = previous;
  }
});

test('report is wired into the product: migration, analytics capture, dashboards', () => {
  const migration = fs.readFileSync('db/migrations/134_agent_weekly_reports.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_weekly_reports/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS country_code/);

  const analytics = fs.readFileSync('routes/analytics.js', 'utf8');
  assert.match(analytics, /resolveVisitorCountry\(req, params\)/);
  assert.match(analytics, /country_code\s*\n\s*\) VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7\)/);

  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /href="#broker-report-panel"[^>]*>Weekly report</);
  assert.match(html, /id="broker-report-panel"/);
  assert.match(html, /data-admin-tab-button="agent-reports"/);
  assert.match(html, /id="admin-agent-reports-control"/);

  const app = fs.readFileSync('assets/makaug-app.js', 'utf8');
  assert.match(app, /async function renderBrokerWeeklyReportPanel/);
  assert.match(app, /\/api\/agents\/me\/weekly-report/);
  assert.match(app, /"agent-reports"/);
  assert.match(app, /visitor_timezone: analyticsVisitorTimezone\(\)/);
  assert.match(app, /Agent ID \$\{adminEscape\(agentNumber\)\}/);

  const admin = fs.readFileSync('routes/admin.js', 'utf8');
  assert.match(admin, /router\.post\('\/agent-reports\/:id\/send'/);
  assert.match(admin, /Approve the report before sending it to the agent/);
  assert.match(admin, /AGENT_REPORT_WHATSAPP_SOURCE \|\| 'whatsapp_runtime'/, 'reports must use a source the WAHA bridge claims by default');
});

test('report card renders a PNG with the agent ID and escapes names', async () => {
  const cards = require('../services/agentReportCardService');
  const svg = cards.buildReportCardSvg({ ...sampleReport, agent: { ...sampleReport.agent, full_name: 'Francis <Okello>' } });
  assert.match(svg, /Agent ID MKA-AG-1234567/);
  assert.match(svg, /Francis &lt;Okello&gt;/);
  assert.match(svg, /Top countries/);
  const png = await cards.renderReportCardPng(sampleReport);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
});

test('report card links are signed and a bad token is refused', async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-secret';
  try {
    const cards = require('../services/agentReportCardService');
    const report = { id: '11111111-2222-3333-4444-555555555555', updated_at: '2026-09-22T10:00:00Z' };
    const url = cards.reportCardUrl(report, 'https://makaug.com');
    const u = new URL(url);
    assert.equal(u.pathname, '/api/agents/report-card/11111111-2222-3333-4444-555555555555.png');
    assert.ok(cards.verifyCardToken(report.id, u.searchParams.get('v'), u.searchParams.get('t')));
    assert.ok(!cards.verifyCardToken(report.id, u.searchParams.get('v'), 'x'.repeat(32)));
    const app = express();
    app.use('/api/agents', require('../routes/agents'));
    const res = await request(app).get(`/api/agents/report-card/${report.id}.png?v=1&t=${'0'.repeat(32)}`);
    assert.equal(res.status, 404);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
  }
});

test('card caption carries property links and the logged-in report link', () => {
  const caption = reports.buildWhatsAppCardCaption(sampleReport);
  assert.match(caption, /Hi Francis, your makaug weekly report is here/);
  assert.match(caption, /Agent ID: \*MKA-AG-1234567\*/);
  assert.match(caption, /https:\/\/makaug\.com\/property\/11111111-1111-1111-1111-111111111111/);
  assert.match(caption, /broker-dashboard#broker-report-panel/);
  const admin = fs.readFileSync('routes/admin.js', 'utf8');
  assert.match(admin, /mediaType: videoUrl \? 'video' : cardUrl \? 'image' : 'text'/);
});

test('recap video scenes show the agent ID, counting stats and countries, and encode to MP4', async () => {
  const video = require('../services/agentReportVideoService');
  const scene = video.buildScenes(sampleReport);
  assert.match(video.frameSvg(scene, 1.2), /makaug\.com/);
  assert.match(video.frameSvg(scene, 4.0), /MKA-AG-1234567/);
  assert.match(video.frameSvg(scene, 7.9), /120 listing views/);
  assert.match(video.frameSvg(scene, 10.0), /United Kingdom/);
  assert.match(video.frameSvg(scene, 12.8), /tap the link below/);
  const bridge = fs.readFileSync('services/whatsappWebBridgeService.js', 'utf8');
  assert.match(bridge, /\['image', 'video'\]\.includes\(requestedMediaType\)/);
  if (video.isVideoRenderingAvailable()) {
    const file = await video.ensureReportVideo({ ...sampleReport, id: '99999999-2222-3333-4444-555555555555' }, 'test');
    assert.ok(fs.statSync(file).size > 50000);
  }
});

test('a broken ffmpeg fails fast instead of hanging the send', async () => {
  const video = require('../services/agentReportVideoService');
  process.env.AGENT_REPORT_FFMPEG_PATH = '/bin/false';
  const started = Date.now();
  try {
    await assert.rejects(video.ensureReportVideo({ ...sampleReport, id: '88888888-2222-3333-4444-555555555555' }, 'broken'));
    assert.ok(Date.now() - started < 30000);
  } finally {
    delete process.env.AGENT_REPORT_FFMPEG_PATH;
  }
});
