'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  buildLeadListFilters,
  closeOpenListingIntentLeads,
  deleteLead,
  leadMatchesListFilter,
  leadSourceLabel,
  restoreLead
} = require('../services/leadService');

const admin = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const properties = fs.readFileSync(path.join(root, 'routes', 'properties.js'), 'utf8');

function openLead(overrides = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    source: 'list_property_online',
    lead_status: 'open',
    is_test: false,
    deleted_at: null,
    contact_name: 'Amina',
    ...overrides
  };
}

test('source names are plain English', () => {
  assert.equal(leadSourceLabel('list_property_whatsapp_ai'), 'Listed on WhatsApp');
  assert.equal(leadSourceLabel('list_property_online'), 'Listed on the website');
  assert.equal(leadSourceLabel('listing_submission'), 'Submitted a listing');
  assert.equal(leadSourceLabel('whatsapp_no_match'), 'WhatsApp search, no match');
});

test('a newly created open lead appears in the default CRM open list', () => {
  const created = openLead();
  const { where } = buildLeadListFilters({ status: 'open_all' });
  assert.match(where, /lead_status IN \('open','handed_over','contacted','qualified'\)/);
  assert.match(where, /deleted_at IS NULL/);
  assert.match(where, /is_test = FALSE/);
  assert.equal(leadMatchesListFilter(created, { status: 'open_all' }), true);
  assert.equal(leadMatchesListFilter(created, { status: 'closed_all' }), false);
  assert.equal(leadMatchesListFilter({ ...created, lead_status: 'closed' }, { status: 'open_all' }), false);
});

test('closed and deleted leads stay off the default list but filters can still find them', () => {
  const closed = openLead({ lead_status: 'closed' });
  const deleted = openLead({ deleted_at: '2026-11-12T07:00:00Z' });
  const junk = openLead({ lead_status: 'spam' });
  assert.equal(leadMatchesListFilter(closed, { status: 'open_all' }), false);
  assert.equal(leadMatchesListFilter(junk, { status: 'open_all' }), false);
  assert.equal(leadMatchesListFilter(deleted, { status: 'open_all' }), false);
  assert.equal(leadMatchesListFilter(closed, { status: 'closed' }), true);
  assert.equal(leadMatchesListFilter(closed, { status: 'closed_all' }), true);
  assert.equal(leadMatchesListFilter(junk, { status: 'closed_all' }), true);
  assert.equal(leadMatchesListFilter(closed, { status: 'all' }), true);
  assert.equal(leadMatchesListFilter(deleted, { status: 'all' }), false);
  assert.equal(leadMatchesListFilter(deleted, { status: 'deleted' }), true);
  const deletedFilter = buildLeadListFilters({ status: 'deleted' });
  assert.match(deletedFilter.where, /deleted_at IS NOT NULL/);
  assert.doesNotMatch(deletedFilter.where, /deleted_at IS NULL/);
});

test('delete and restore persist on the lead and write an activity', async () => {
  const lead = openLead({ deleted_at: null, deleted_by_user_id: null });
  const activities = [];
  const db = {
    async query(sql, params) {
      if (/SET deleted_at = NOW\(\)/i.test(sql) && /deleted_at IS NULL/i.test(sql)) {
        assert.equal(params[0], lead.id);
        if (lead.deleted_at) return { rows: [] };
        lead.deleted_at = '2026-11-12T07:10:00Z';
        lead.deleted_by_user_id = params[1];
        return { rows: [{ ...lead }] };
      }
      if (/SET deleted_at = NULL/i.test(sql) && /deleted_at IS NOT NULL/i.test(sql)) {
        assert.equal(params[0], lead.id);
        if (!lead.deleted_at) return { rows: [] };
        lead.deleted_at = null;
        lead.deleted_by_user_id = null;
        return { rows: [{ ...lead }] };
      }
      if (/INSERT INTO lead_activities/i.test(sql)) {
        activities.push({ type: params[3], message: params[4] });
        return { rows: [{ id: 'act' }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  const deleted = await deleteLead(db, lead.id, { actorUserId: 'staff-1', note: 'Junk listing start' });
  assert.ok(deleted.deleted_at);
  assert.equal(deleted.deleted_by_user_id, 'staff-1');
  assert.equal(leadMatchesListFilter(deleted, { status: 'open_all' }), false);
  assert.equal(leadMatchesListFilter(deleted, { status: 'deleted' }), true);
  assert.equal(activities.at(-1).type, 'deleted');

  const again = await deleteLead(db, lead.id, { actorUserId: 'staff-1' });
  assert.equal(again, null);

  const restored = await restoreLead(db, lead.id, { actorUserId: 'staff-1' });
  assert.equal(restored.deleted_at, null);
  assert.equal(leadMatchesListFilter(restored, { status: 'open_all' }), true);
  assert.equal(activities.at(-1).type, 'restored');
});

test('closing a listing-intent lead marks it done so it leaves the open list', async () => {
  const sqls = [];
  const db = {
    async query(sql, params) {
      sqls.push(sql);
      if (/UPDATE leads l/i.test(sql)) {
        assert.ok(params[0] === '772000001' || params[0] == null);
        assert.match(sql, /list_property_whatsapp_ai/);
        assert.match(sql, /list_property_online/);
        assert.match(sql, /lead_status = 'won'/);
        return { rows: [{ id: 'lead-1', lead_status: 'won' }], rowCount: 1 };
      }
      if (/INSERT INTO lead_activities/i.test(sql)) {
        assert.equal(params[6], 'won');
        return { rows: [{}] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
  const closed = await closeOpenListingIntentLeads(db, {
    phone: '0772000001',
    email: 'owner@example.com',
    inquiryReference: 'MK-TEST-LEAD'
  });
  assert.equal(closed, 1);
  assert.equal(leadMatchesListFilter(openLead({ lead_status: 'won' }), { status: 'open_all' }), false);
});

test('admin routes and the staff UI wire delete, close, and the open default list', () => {
  assert.match(admin, /router\.delete\('\/leads\/:id'/);
  assert.match(admin, /router\.post\('\/leads\/:id\/restore'/);
  assert.match(admin, /buildLeadListFilters/);
  assert.match(admin, /deleted_at/);
  assert.match(properties, /closeOpenListingIntentLeads/);

  assert.match(html, /value="open_all" selected/);
  assert.match(html, /value="deleted">Deleted/);
  assert.match(html, /Showing the latest open leads/);
  assert.doesNotMatch(html, />Any status</);

  assert.match(app, /function deleteAdminCrmLead/);
  assert.match(app, /function restoreAdminCrmLead/);
  assert.match(app, /window\.confirm\("Delete this lead\?/);
  assert.match(app, /setAdminCrmLeadStatus\(\$\{leadIdArg\}, 'closed'\)/);
  assert.match(app, /Mark done/);
  assert.match(app, /Not useful/);
  assert.match(app, /Listed on WhatsApp/);
  assert.match(app, /No name or phone yet/);
  assert.doesNotMatch(app, /Unknown contact/);
  assert.match(app, /\/api\/admin\/leads\?limit=50&status=open_all/);
  assert.match(app, /await applyAdminCrmLeadFilters\(\);/);
  assert.match(app, /No open leads in this list/);
  assert.match(app, /Kampala-rent-Jul|Optional tag/);
});
