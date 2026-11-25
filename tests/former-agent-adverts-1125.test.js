'use strict';

/**
 * 25 Nov 2026, 08:42 in Kampala. Every name and number here is made up.
 *
 * An agent removed the day before for not paying sent two adverts in words:
 * a school on sale "… the owner wants 300m", and twelve units "… owner wants
 * 750mbut negotiable". The school was answered "I've passed your message to
 * our team", as if it were a question. The units were not read as an advert
 * at all: the m was typed against "but", so they had no price, and King's
 * import of his forwarded adverts left them out.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const desk = require('../services/leadDeskService');

test('a price typed against the next word is still the price', () => {
  const units = route.employeePropertyFacts('Those Houses are on sale located on Namugongo Road seeta lumuli, there 12 units self contained on 50decimals, title available, owner wants 750mbut negotiable, see the video', {});
  assert.strictEqual(units.price, 750000000);
  assert.deepStrictEqual(route.employeePropertyMissing(units), []);
  assert.strictEqual(route.employeePropertyFacts('Plot for sale in Kira 45mnegotiable', {}).price, 45000000);
  assert.strictEqual(route.employeePropertyFacts('Room for rent in Ntinda 500konly', {}).price, 500000);
  // Kilometres and the like are not touched.
  assert.strictEqual(route.employeePropertyFacts('Land for sale in Kira, 5km from the tarmac, at 45m', {}).price, 45000000);
});

test('a removed agent\'s advert in words is kept as an advert, not passed on as a question', async () => {
  const agent = {
    id: '0e0e0e0e-0000-4000-8000-000000000061', full_name: 'Moses Testname', phone: '+256700000161', whatsapp: '+256700000161', status: 'suspended',
    removed_at: '2026-11-24T14:08:01Z', removed_reason: 'Has not paid yet',
    removal_snapshot: { reason_code: 'not_paying', rejoin_sent_at: new Date(Date.now() - 2 * 3600e3).toISOString() }
  };
  const saved = { query: db.query, send: desk.sendToTeam };
  db.query = async (sql) => (/FROM agents\s+WHERE RIGHT\(REGEXP_REPLACE\(COALESCE\(whatsapp/i.test(String(sql)) ? { rows: [agent] } : { rows: [] });
  desk.sendToTeam = async () => [];
  route.formerAgentAckedAt.clear();
  try {
    for (const body of [
      "The above senior secondary school it's on sale located at Mukono Katosi road, 1 acre and 50 decimals, title available, the owner wants 300m",
      'Those Houses are on sale located on Namugongo Road, 12 units self contained, owner wants 750mbut negotiable, see the video'
    ]) {
      const reply = await route.removedAgentReply({ phone: '256700000161', body, hasMedia: false });
      assert.deepStrictEqual(reply, { message: '', silent: true }, body.slice(0, 30));
    }
    assert.ok(!route.formerAgentWords.has(agent.id), 'nothing waiting to go to the team as a question');
    // A question is still a question.
    const asked = await route.removedAgentReply({ phone: '256700000161', body: 'Can I pay half this month?', hasMedia: false });
    assert.match(asked.message, /^Thank you, Moses 🙏 I've passed your message to our team/);
  } finally {
    db.query = saved.query;
    desk.sendToTeam = saved.send;
    for (const [key, entry] of route.formerAgentWords) { clearTimeout(entry.timer); route.formerAgentWords.delete(key); }
  }
});
