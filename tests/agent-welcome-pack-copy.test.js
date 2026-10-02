'use strict';

/**
 * The welcome pack an agent gets the moment their account goes live.
 *
 * This is the first thing makaug ever says to someone who has agreed to put
 * their stock on the platform, so it has two jobs: tell them what they get
 * (we pass the buyer straight to them) and tell them how to post. Everything
 * else is supporting detail.
 *
 * It also makes claims about our audience, to a real person, who may well
 * repeat them. Two rules follow from that and are enforced here:
 *
 *   - Anything we can measure is measured. Live listings and the agent's own
 *     listing count come from the database, not from a constant.
 *   - Anything we cannot measure from this database — the audience across all
 *     the group's platforms — is stated in exactly one place, with an env
 *     override, so it can be corrected in a minute rather than a deploy.
 *
 * And a smaller one, learned from the data: countryName() returns the raw code
 * when it does not recognise it, so an agent was about to be shown bubbles
 * reading "BR" and "BD" as though those were countries.
 */

const test = require('node:test');
const assert = require('node:assert');

const welcome = require('../services/agentWelcomeService');
const video = require('../services/agentReportVideoService');

const AGENT = {
  id: '11111111-2222-3333-4444-555555555555',
  full_name: 'Jonathan Wassajja',
  makaug_agent_number: 'MK-A0142'
};

// makaug's real numbers on the morning this was written.
const STATS = {
  live_listings: 4056,
  agents: 16,
  views_30d: 1857,
  visitors_30d: 1449,
  countries_count: 8,
  diaspora_countries: [
    { code: 'GB', name: 'United Kingdom' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'US', name: 'United States' },
    { code: 'KE', name: 'Kenya' }
  ]
};

const message = () => welcome.buildWelcomeMessage({ agent: AGENT, stats: STATS });
const caption = () => welcome.buildWelcomeCaption({ agent: AGENT, stats: STATS });

test('the first promise is the one they joined for', () => {
  const body = message();
  const leads = body.indexOf('We send you the buyer');
  assert.ok(leads > 0, 'the leads promise must be in the message');
  assert.ok(leads < body.indexOf('What makaug is'),
    'it comes before we start describing ourselves');
  assert.match(body, /straight to you on WhatsApp/, 'and it says how the lead arrives');
  assert.match(body, /their name, their number and what they asked/, 'and what they will get');
  assert.match(body, /no commission/i, 'the deal stays theirs');
});

test('it explains how to post, in the channel they are reading it in', () => {
  const body = message();
  assert.match(body, /\*How to post a property/);
  assert.match(body, /right here on WhatsApp/,
    'the fastest route is the one they are already in');
  assert.match(body, /Say \*hello\*/, 'the same first step as the bot and the film');
  assert.match(body, /exact area and district/, 'the two things intake always has to ask for');
  assert.match(body, /3 bedroom house for rent in Kira, Wakiso/, 'shown, not just described');
});

test('the audience figures say which is which', () => {
  const body = message();
  assert.match(body, /4,056 live listings/, 'measured: straight from the properties table');
  assert.match(body, /10,000\+ people a month searching across our platforms, from 7 countries/,
    'stated: the whole group, and labelled as such rather than passed off as makaug alone');
  assert.match(body, /1,857 listing views on makaug in the last 30 days/,
    'a makaug-only number must say it is makaug-only');
  assert.doesNotMatch(body, /1,449/,
    'the makaug-only visitor count must not sit next to the network one — two different '
    + 'measures of "people", a month apart in size, invites exactly the wrong question');
});

test('the growth target names a month that is still ahead', () => {
  const body = message();
  const next = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))
    .toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  assert.match(body, new RegExp(`On track for 20,000 a month by the end of ${next}`),
    'a hard-coded "October" would still be there in December');
  assert.strictEqual(welcome.targetMonthName(new Date('2026-12-15T00:00:00Z')), 'January',
    'and it rolls over the year end');
});

test('the numbers can be corrected without a deploy', () => {
  const before = process.env.NETWORK_MONTHLY_VISITORS;
  try {
    process.env.NETWORK_MONTHLY_VISITORS = '14500';
    assert.strictEqual(welcome.networkAudience().monthly, 14500);
    assert.match(welcome.buildWelcomeMessage({ agent: AGENT, stats: STATS }), /14,500\+ people a month/);
  } finally {
    if (before === undefined) delete process.env.NETWORK_MONTHLY_VISITORS;
    else process.env.NETWORK_MONTHLY_VISITORS = before;
  }
  assert.strictEqual(welcome.networkAudience().monthly, 10000, 'and falls back to the stated figure');
});

test('the caption is short enough to read on a notification', () => {
  const text = caption();
  assert.ok(text.length < 240, `caption is ${text.length} characters — it sits under a video`);
  assert.match(text, /Jonathan/, 'it is addressed to them');
  assert.match(text, /MK-A0142/, 'and carries the ID they will be asked to quote');
  assert.match(text, /Enquiries on your properties come straight to this number/,
    'the promise survives even if they never open the long message');
});

test('an agent is never shown a country code as a country name', () => {
  // countryName() echoes the code back when it has no name for it, which is how
  // "BR" and "BD" reached the top-countries list in production.
  const body = welcome.buildWelcomeMessage({
    agent: AGENT,
    stats: { ...STATS, diaspora_countries: [{ code: 'GB', name: 'United Kingdom' }, { code: 'BD', name: 'BD' }] }
  });
  assert.doesNotMatch(body, /searching from United Kingdom, BD/,
    'unnamed codes are filtered in computePlatformStats before they ever reach the copy');
});

test('the welcome video carries the same promise and fits in one clip', () => {
  const payload = { agent: AGENT, stats: STATS };
  const duration = video.welcomeDuration(payload);
  assert.ok(duration <= 30,
    `the video is ${duration.toFixed(1)}s — WhatsApp splits a status clip over 30s`);
  assert.ok(duration >= 20, 'and long enough to say something');

  const scene = video.buildWelcomeScenes(payload);
  const frames = [];
  for (let t = 0; t < duration; t += 0.25) frames.push(scene(t));
  const all = frames.join('');
  assert.ok(all.includes('the buyer'), 'the leads scene is in the timeline');
  assert.ok(all.includes('Straight to your WhatsApp'), 'and says where the lead lands');
  assert.ok(all.includes('Across our platforms'), 'the stats scene is labelled as the group, not makaug alone');
  assert.ok(all.includes('Heading for 20,000'), 'the target is on screen too');
  assert.ok(all.includes('4,056'), 'and the measured listing count is real');
});

test('every frame of the video renders', () => {
  const payload = { agent: AGENT, stats: STATS };
  const duration = video.welcomeDuration(payload);
  const scene = video.buildWelcomeScenes(payload);
  for (let t = 0; t < duration; t += 0.1) {
    const svg = video.frameSvg(scene, t);
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `frame at ${t.toFixed(1)}s is malformed`);
    assert.ok(!svg.includes('undefined'), `frame at ${t.toFixed(1)}s renders the word "undefined"`);
    assert.ok(!svg.includes('NaN'), `frame at ${t.toFixed(1)}s renders NaN`);
  }
});

test('an agent with no listings and no stats still gets a sound message', () => {
  // The welcome goes out the moment the account is approved, which is usually
  // before they have posted anything and can be before the stats query answers.
  const body = welcome.buildWelcomeMessage({ agent: { id: 'x', full_name: 'Sewa sewa' }, stats: {} });
  assert.match(body, /Hi Sewa,/);
  assert.match(body, /We send you the buyer/, 'the promise does not depend on a number');
  assert.match(body, /10,000\+ people a month/, 'nor does the audience line');
  assert.doesNotMatch(body, /undefined|NaN|• 0 /, 'and nothing empty leaks through');
  assert.ok(body.length < 4000, 'WhatsApp truncates beyond this');
});
