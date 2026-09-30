'use strict';

/**
 * "As soon as it's approved, a message is sent out to them."
 *
 * That message has existed since the day a listing could be approved. It has
 * never once arrived. It went out through sendWhatsAppText — the Meta/Twilio
 * provider path — and neither provider is configured on this deployment:
 *
 *   {"sent":false,"reason":"no_whatsapp_provider_configured",
 *    "meta":{"reason":"meta_whatsapp_not_configured"},
 *    "twilio":{"reason":"twilio_whatsapp_not_configured"}}
 *
 * Every WhatsApp message makaug actually sends goes through the WAHA bridge
 * outbox. Lead handoff learned that; listing moderation never did. So the one
 * moment an agent most wants to hear from us has been dropped on the floor
 * every single time, silently, while the moderation screen reported success.
 *
 * These tests hold two things: that the message is built for an agent rather
 * than for a one-off owner, and that it leaves by a road that exists.
 */

const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const moderation = require('../services/listingModerationService');

const AGENT_LISTING = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  agent_id: '9d1f0a3e-1111-2222-3333-444455556666',
  title: '3 bedroom house for rent in Kira',
  listing_type: 'rent',
  inquiry_reference: 'MK-44120',
  lister_name: 'Katamba Bonny',
  lister_phone: '256701895892',
  area: 'Kira',
  district: 'Wakiso',
  price: 1200000,
  price_period: 'month'
};

const OWNER_LISTING = { ...AGENT_LISTING, agent_id: null, lister_name: 'Sarah N' };

test('an agent is told to share it, not how to delete it', () => {
  const message = moderation.buildOwnerStatusMessage({ listing: AGENT_LISTING, status: 'approved' });
  const text = message.whatsapp;

  assert.match(text, /Your property is live on makaug\.com/);
  assert.match(text, /3 bedroom house for rent in Kira/);
  assert.match(text, /Kira, Wakiso/, 'where it is');
  assert.match(text, new RegExp(`/property/${AGENT_LISTING.id}`), 'the link they will share');
  assert.match(text, /Share that link anywhere/);
  assert.match(text, /your name and number on it/, 'the reason an agent cares');
  assert.match(text, /Got another one\? Send it here/, 'the next property is the point');

  assert.doesNotMatch(text, /reply REMOVE/,
    '"here is how to delete it" is the wrong first thought for someone building a shopfront');
});

test('a private owner keeps the message they always had', () => {
  const text = moderation.buildOwnerStatusMessage({ listing: OWNER_LISTING, status: 'approved' }).whatsapp;
  assert.match(text, /Great news Sarah N/);
  assert.match(text, /reply REMOVE MK-44120/,
    'an owner who listed one house does want to know how to take it down');
  assert.doesNotMatch(text, /Got another one/);
});

test('the agent card goes with it', () => {
  // Card links are signed, so the test needs the same secret production has.
  const before = process.env.AGENT_REPORT_CARD_SECRET;
  process.env.AGENT_REPORT_CARD_SECRET = 'test-card-secret';
  try {
    const text = moderation.buildOwnerStatusMessage({ listing: AGENT_LISTING, status: 'approved' }).whatsapp;
    // Built from the agent id alone, so approving a listing costs no extra query.
    assert.match(text, /Your agent card/);
    assert.match(text, new RegExp(`share-card/${AGENT_LISTING.agent_id}`));
  } finally {
    if (before === undefined) delete process.env.AGENT_REPORT_CARD_SECRET;
    else process.env.AGENT_REPORT_CARD_SECRET = before;
  }
});

test('an unsigned card link is left out rather than sent broken', () => {
  // No secret configured: the card URL cannot be signed, so it must be omitted
  // entirely rather than shipped as a link that 403s in the agent's face.
  const before = process.env.AGENT_REPORT_CARD_SECRET;
  const beforeJwt = process.env.JWT_SECRET;
  const beforeBridge = process.env.WHATSAPP_WEB_BRIDGE_TOKEN;
  delete process.env.AGENT_REPORT_CARD_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.WHATSAPP_WEB_BRIDGE_TOKEN;
  try {
    const text = moderation.buildOwnerStatusMessage({ listing: AGENT_LISTING, status: 'approved' }).whatsapp;
    assert.doesNotMatch(text, /Your agent card/);
    assert.match(text, /Your property is live/, 'the rest of the message still goes');
  } finally {
    if (before !== undefined) process.env.AGENT_REPORT_CARD_SECRET = before;
    if (beforeJwt !== undefined) process.env.JWT_SECRET = beforeJwt;
    if (beforeBridge !== undefined) process.env.WHATSAPP_WEB_BRIDGE_TOKEN = beforeBridge;
  }
});

test('a listing with no agent asks for no card', () => {
  const text = moderation.buildOwnerStatusMessage({ listing: OWNER_LISTING, status: 'approved' }).whatsapp;
  assert.doesNotMatch(text, /agent card|share-card/);
});

test('the message leaves by the road that exists', async () => {
  // Stand in for the bridge and record what it is asked to queue.
  const queued = [];
  const bridgePath = require.resolve('../services/whatsappWebBridgeService');
  const original = require.cache[bridgePath];
  require.cache[bridgePath] = {
    id: bridgePath,
    filename: bridgePath,
    loaded: true,
    exports: {
      getWhatsappDeliveryMode: () => 'web_bridge',
      isWhatsappWebBridgeEnabled: () => true,
      queueWhatsappWebBridgeMessage: async (msg) => { queued.push(msg); return { id: 'queue-1' }; }
    }
  };
  try {
    const result = await moderation.sendOwnerListingStatusNotifications({
      listing: AGENT_LISTING,
      status: 'approved'
    });
    assert.strictEqual(queued.length, 1, 'exactly one message queued for the bridge');
    assert.strictEqual(queued[0].recipient.replace(/\D/g, '').slice(-9), '701895892',
      'addressed to the agent');
    assert.match(queued[0].text, /Your property is live/);
    assert.strictEqual(queued[0].metadata.listing_id, AGENT_LISTING.id,
      'tagged with the listing, so a duplicate approval cannot send it twice');
    assert.ok(result.whatsapp.sent,
      'and reported as sent — the moderation screen was previously told "sent" while nothing left');
    assert.strictEqual(result.whatsapp.provider, 'whatsapp_web_bridge');
  } finally {
    if (original) require.cache[bridgePath] = original;
    else delete require.cache[bridgePath];
  }
});

test('a listing with no phone is reported honestly, not as sent', async () => {
  const result = await moderation.sendOwnerListingStatusNotifications({
    listing: { ...AGENT_LISTING, lister_phone: null },
    status: 'approved'
  });
  assert.strictEqual(result.whatsapp.sent, false);
  assert.strictEqual(result.whatsapp.reason, 'no_lister_phone');
});

test('the approval endpoint carries the agent through', () => {
  // The wording above only fires when agent_id reaches the notification, and it
  // reaches it from the UPDATE that approves the listing.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  const clauses = source.match(/RETURNING id, title, listing_type, inquiry_reference, lister_name, lister_phone, lister_email, agent_id,/g) || [];
  assert.strictEqual(clauses.length, 2,
    'both approval paths must return agent_id, or an agent silently gets the owner message');
});

/**
 * A found-online listing's "lister" never asked to hear from us.
 *
 * makaug sources listings from X, TikTok and Facebook. The phone on those
 * belongs to whoever posted the advert on their own page: somebody who never
 * signed up, never gave permission, and would receive "🎉 Your property is live
 * on makaug.com" about a listing they did not know we had made. There are 23
 * such agencies in the database — Knight Frank Uganda, Broll Uganda and the
 * rest — and a review queue largely made of their posts.
 *
 * The lead handoff has refused to message them since it was written. Making
 * approvals send automatically put that promise one click away from being
 * broken at scale, so this path now refuses too.
 */
const FOUND_ONLINE = {
  id: 'ffffffff-0000-1111-2222-333333333333',
  title: 'SINGLE ROOM FOR RENT – LUZIRA',
  lister_name: 'SWH RENTALS',
  lister_phone: '256700111222',
  lister_email: 'someone@example.com',
  area: 'Luzira',
  district: 'Kampala',
  price: 300000
};

test('a scraped poster is never messaged, however the listing is marked', async () => {
  const shapes = [
    { source: 'found_online_property_source_v1' },
    { listed_via: 'found_online' },
    { extra_fields: { source_badge: 'Found Online' } },
    { extra_fields: { found_online: true } },
    { extra_fields: { found_online_candidate: 'yes' } },
    { extra_fields: { social_search_candidate: '1' } },
    { extra_fields: { sourced_inventory_candidate: true } },
    { is_found_online: true }
  ];
  for (const shape of shapes) {
    const result = await moderation.sendOwnerListingStatusNotifications({
      listing: { ...FOUND_ONLINE, ...shape },
      status: 'approved'
    });
    assert.strictEqual(result.whatsapp.sent, false, `${JSON.stringify(shape)} must not be messaged`);
    assert.strictEqual(result.whatsapp.reason, 'found_online_listing_never_messaged');
    assert.strictEqual(result.email.sent, false, 'nor emailed');
  }
});

test('the guard knows every marker the platform SQL knows', () => {
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'utils', 'foundOnlineSql.js'), 'utf8');
  for (const marker of ['found_online_candidate', 'social_search_candidate', 'sourced_inventory_candidate']) {
    assert.ok(sql.includes(marker), `${marker} is in the shared SQL`);
    assert.ok(moderation.isFoundOnlineListing({ extra_fields: { [marker]: true } }),
      `${marker} must be recognised here too, or the two definitions drift apart`);
  }
  assert.ok(moderation.isFoundOnlineListing({ source: 'found_online_property_source_v1' }));
  assert.ok(moderation.isFoundOnlineListing({ listed_via: 'found_online' }));
  assert.ok(!moderation.isFoundOnlineListing({ source: 'whatsapp_employee_intake' }),
    'an agent posting through WhatsApp is not a scraped poster');
});

test('a real agent listing is still notified', async () => {
  const queued = [];
  const bridgePath = require.resolve('../services/whatsappWebBridgeService');
  const original = require.cache[bridgePath];
  require.cache[bridgePath] = {
    id: bridgePath, filename: bridgePath, loaded: true,
    exports: {
      getWhatsappDeliveryMode: () => 'web_bridge',
      isWhatsappWebBridgeEnabled: () => true,
      queueWhatsappWebBridgeMessage: async (msg) => { queued.push(msg); return { id: 'q' }; }
    }
  };
  try {
    const result = await moderation.sendOwnerListingStatusNotifications({
      listing: AGENT_LISTING,
      status: 'approved'
    });
    assert.ok(result.whatsapp.sent, 'the guard must not swallow a genuine agent listing');
    assert.strictEqual(queued.length, 1);
  } finally {
    if (original) require.cache[bridgePath] = original;
    else delete require.cache[bridgePath];
  }
});

test('the approval endpoint carries the source through', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  const clauses = source.match(/lister_email, agent_id, source, listed_via, status,/g) || [];
  assert.strictEqual(clauses.length, 2,
    'without source and listed_via the guard cannot tell a scraped listing from a real one');
});
