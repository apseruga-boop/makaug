'use strict';

/**
 * When an off-plan project goes live, the developer's contact hears by
 * WhatsApp and email, and the team hears by WhatsApp (6 Nov 2026, Vanta House:
 * "as soon as it goes live, send him a message saying it's live… and one to
 * Ronald").
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { publishedWhatsappBody, publishedEmail, teamPublishedBody, publicProjectUrl } = require('../services/offPlanNotificationService');

const VANTA = {
  id: 'dev-1', slug: 'vanta-house', name: 'Vanta House', country_code: 'UG', area: 'Naguru', district: 'Kampala',
  developer_name: 'Blackstone Real Estate Limited', source_agent_name: 'John Yan', source_agent_whatsapp: '+256709973205', source_agent_email: 'developer@example.com',
  extra_fields: { walkthroughs: [{ unit_key: '1bhk' }, { unit_key: '2bhk' }, { unit_key: '3bhk' }] }
};

test('the lister is told the page is live, what is on it, and who is writing', () => {
  const body = publishedWhatsappBody(VANTA, { name: 'John Yan', phone: '+256709973205' });
  assert.match(body, /^Hi John, Vanta House is now live on makaug\.com\./);
  assert.match(body, /https:\/\/makaug\.com\/off-plan\/vanta-house/);
  assert.match(body, /3 walkthrough videos/);
  assert.match(body, /construction progress/);
  assert.match(body, /Phillip, makaug\.com$/, 'signed by the assistant, never as a person on the team');
  assert.doesNotMatch(body, /Arthur/);
  const email = publishedEmail(VANTA, { name: 'John Yan' });
  assert.strictEqual(email.subject, 'Vanta House is live on makaug.com');
  assert.match(email.text, /Hello John Yan,/);
  assert.match(email.text, /brochure in nine languages/);
  assert.match(email.text, /Phillip, makaug\.com$/);
});

test('the team message names the project, the contact and whether they were reached', () => {
  const body = teamPublishedBody(VANTA, { name: 'John Yan', phone: '+256709973205' }, { whatsapp: { sent: true }, email: { sent: false } });
  assert.match(body, /^🏗️ \*Off-plan project live: Vanta House\*\nNaguru, Kampala · Blackstone Real Estate Limited\nhttps:\/\/makaug\.com\/off-plan\/vanta-house\nDeveloper contact: John Yan \+256709973205 — told by WhatsApp\.\n/);
  assert.match(teamPublishedBody(VANTA, { name: 'John Yan' }, {}), /not reached/);
  assert.strictEqual(publicProjectUrl({ ...VANTA, country_code: 'KE' }), 'https://makaug.com/off-plan/vanta-house?country=KE');
});

test('the status route sends it after the response, once, on the first publish only, and Ronald is on the team copy', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'off-plan.js'), 'utf8');
  const block = route.slice(route.indexOf("router.post('/developments/:id/status'"), route.indexOf("router.get('/enquiries'"));
  assert.match(block, /const before = await getManagedDevelopment\(db, req\.params\.id\)/);
  assert.match(block, /development\.status === 'published' && before\?\.status !== 'published'/);
  assert.match(block, /setImmediate\(/, 'after the response');
  assert.match(block, /notifyOffPlanPublished\(publicRow \|\| development, \{ db \}\)/);
  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'offPlanNotificationService.js'), 'utf8');
  assert.match(service, /process\.env\.AGENT_HELP_CONTACT_PHONE \|\| '256709402189'/, 'Ronald');
  assert.match(service, /deliverListingWhatsapp\(\{ to: contact\.phone/);
});
