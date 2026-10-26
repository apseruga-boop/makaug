'use strict';

/**
 * Cross-video duplicates (26 Oct 2026, Arthur). MK-20261024-67E51F and
 * MK-20261024-400346 are the same 12-decimal Kira-Nsasa plot from two
 * different BitEstate Africa YouTube videos (100M, then "price dropped to
 * 70M"). A new or pending listing that matches a live or pending one on the
 * same phone/channel/lister + same area + similar plot/size/price/caption is
 * flagged "Possible duplicate of <ref>" for staff. Existing rows are never
 * changed and nothing is hidden or auto-published.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { crossVideoDuplicateReason, possibleDuplicateWarning } = require('../utils/crossVideoDuplicate');
const { DUPLICATE_CANDIDATES_SQL, classifyDuplicates, duplicateCandidateParams, duplicateReason } = require('../utils/duplicateEvidence');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// The two production rows (read-only export, 26 Oct 2026).
const plot400346 = {
  id: '2a4353f2-6bd9-4c59-bbd1-ad7ed797488f',
  inquiry_reference: 'MK-20261024-400346',
  title: 'Plot for sale in Kira-Nsasa',
  listing_type: 'land',
  district: 'Wakiso',
  area: 'Kira-Nsasa',
  price: 70000000,
  status: 'approved',
  lister_name: 'BitEstate Africa',
  lister_phone: '+256702715370',
  source_url: 'https://www.youtube.com/watch?v=NQeagorxOiU',
  source_title: 'Prime Hilltop plot in Kira at whole sale price.',
  caption: 'WHOLESALE DEAL!!! Hilltop 12 decimals #Plot (ready title) in #Kira Nsasa on sale at 70m Ugx (last) For inspection arrangements/more details Call/WhatsApp 0702715370 #BitEstate #Buyland #realestateuganda',
  source_registry_key: 'ucgasefvmkdg-ldxzmcfgwlg'
};
const plot67E51F = {
  id: '70fb505f-48e7-4132-92d1-393dbfc90a93',
  inquiry_reference: 'MK-20261024-67E51F',
  title: 'Land in Kira-Nsasa',
  listing_type: 'land',
  district: 'Wakiso',
  area: 'Kira-Nsasa',
  price: 100000000,
  status: 'pending',
  lister_name: 'BitEstate Africa',
  lister_phone: '+256702715370',
  source_url: 'https://www.youtube.com/watch?v=SfsyCTN-KK0',
  source_title: 'Kira Nsasa Hilltop plot price dropped from 100m to 70m Ugx',
  caption: 'PRICE DROP FROM 100m Ugx to #70m Ugx Hilltop 12 decimals #Plot with a ready private mailo title found in #Kira Nsasa: Beautiful view, good neighborhood For inspection arrangements/more details Call/WhatsApp 0702715370 #BitEstate #realestateuganda',
  source_registry_key: 'ucgasefvmkdg-ldxzmcfgwlg'
};

test('67E51F and 400346 (two videos, 100M vs 70M) are flagged as one plot', () => {
  for (const [a, b] of [[plot67E51F, plot400346], [plot400346, plot67E51F]]) {
    const reason = crossVideoDuplicateReason(a, b);
    assert.ok(reason, 'flagged both ways');
    assert.equal(reason.code, 'same_lister_area_similar_plot');
    assert.match(reason.label, /same phone, same area/);
    assert.ok(reason.evidence.includes('same plot size'));
    assert.ok(reason.evidence.includes('caption quotes the other price'));
  }
  const reason = duplicateReason(plot67E51F, plot400346);
  assert.equal(reason.code, 'same_lister_area_similar_plot');
  const [row] = classifyDuplicates(plot67E51F, [plot400346]);
  assert.equal(row.inquiry_reference, 'MK-20261024-400346');
  assert.equal(possibleDuplicateWarning(row), 'Possible duplicate of MK-20261024-400346');
});

test('the same channel without a phone still counts as the same lister', () => {
  const a = { ...plot67E51F, lister_phone: '', lister_name: '' };
  const b = { ...plot400346, lister_phone: '', lister_name: '' };
  assert.match(crossVideoDuplicateReason(a, b).label, /same source channel/);
});

test('same lister and area alone is not a duplicate (C10)', () => {
  const other = { ...plot400346, id: 'x', source_url: 'https://www.youtube.com/watch?v=other1', title: 'Plot for sale in Kira-Nsasa', source_title: 'Kira Nsasa plot', caption: '' };
  assert.equal(crossVideoDuplicateReason({ ...plot67E51F, source_title: 'New plot', caption: '' }, other), null, 'similar price alone');
  assert.equal(crossVideoDuplicateReason(plot67E51F, { ...plot400346, area: 'Kira-Mulawa' }), null, 'different area');
  assert.equal(crossVideoDuplicateReason(plot67E51F, { ...plot400346, lister_phone: '+256772000111', lister_name: 'Someone Else', source_registry_key: 'other-channel' }), null, 'different lister');
  assert.equal(crossVideoDuplicateReason(plot67E51F, { ...plot400346, caption: plot400346.caption.replace('12 decimals', '25 decimals') }), null, 'different plot size');
});

test('different bedrooms, unit counts, kinds or template locations are different properties', () => {
  const house = { id: 'h1', listing_type: 'sale', area: 'Kyanja', lister_phone: '0772111222', price: 1300000000 };
  const caption = 'Rental investment apartment for sale location in kyanja KAMPALA 8 units Monthly income 10m';
  assert.ok(crossVideoDuplicateReason({ ...house, caption }, { ...house, id: 'h2', caption }), 'same text and price');
  assert.equal(crossVideoDuplicateReason({ ...house, caption }, { ...house, id: 'h2', caption: caption.replace('8 units', '16 units') }), null);
  const rent = { id: 'r1', listing_type: 'rent', area: 'Muyenga', lister_phone: '0780108612', price: 2000000 };
  assert.equal(crossVideoDuplicateReason({ ...rent, title: '2 bedroom apartment for rent in Muyenga' }, { ...rent, id: 'r2', title: '3 bedroom apartment for rent in Muyenga' }), null);
  assert.equal(crossVideoDuplicateReason({ ...rent, title: 'Single room for rent in Muyenga at 2m' }, { ...rent, id: 'r2', title: 'Apartment for rent in Muyenga at 2m' }), null);
  const tpl = { id: 't1', listing_type: 'land', area: 'Kira', lister_phone: '0700000001', price: 75000000 };
  assert.equal(crossVideoDuplicateReason(
    { ...tpl, caption: 'Plots For Sale Location; Kira-Mulawa shimon Estate Plot Size; 50Ft by 100Ft Price ; 75M Tenure ; Ready' },
    { ...tpl, id: 't2', price: 80000000, caption: 'Plots For Sale Location; Kira-Nsasa Plot Size; 50Ft by 100Ft Price ; 80M Tenure ; Ready' }
  ), null);
});

test('the candidate query finds same-channel rows in the same area and never writes', () => {
  assert.match(DUPLICATE_CANDIDATES_SQL, /source_registry_key/);
  assert.doesNotMatch(DUPLICATE_CANDIDATES_SQL, /\b(UPDATE|DELETE|INSERT)\b/i);
  const params = duplicateCandidateParams({ ...plot67E51F, extra_fields: {} });
  assert.equal(params.length, 7);
  assert.equal(params[4], 'Kira-Nsasa');
  assert.equal(params[5], 'ucgasefvmkdg-ldxzmcfgwlg');
  assert.equal(params[6], 'bitestate africa');
});

test('the harvester tags only the new pending listing and never updates the existing one', async () => {
  const { possibleDuplicateOfNewListing, withPossibleDuplicateOf } = require('../services/socialSearchSourcedListingsService');
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push(String(sql));
      if (sql === DUPLICATE_CANDIDATES_SQL) {
        assert.equal(params[0], '00000000-0000-0000-0000-000000000000');
        return { rows: [plot400346] };
      }
      return { rows: [] };
    }
  };
  const newListing = {
    ...plot67E51F,
    id: undefined,
    status: 'pending',
    moderation_reason: 'Pending King review.',
    extra_fields: JSON.stringify({ source_url: plot67E51F.source_url, source_caption: plot67E51F.caption, source_title: plot67E51F.source_title, source_registry_key: plot67E51F.source_registry_key })
  };
  delete newListing.caption;
  delete newListing.source_title;
  const tag = await possibleDuplicateOfNewListing(client, newListing);
  assert.equal(tag.ref, 'MK-20261024-400346');
  assert.equal(tag.warning, 'Possible duplicate of MK-20261024-400346');
  assert.equal(tag.reason_code, 'same_lister_area_similar_plot');
  assert.ok(calls.every((sql) => !/\b(UPDATE|DELETE)\b/i.test(sql)), 'read-only');
  const tagged = withPossibleDuplicateOf(newListing, tag);
  assert.equal(tagged.status, 'pending', 'never auto-published');
  assert.equal(JSON.parse(tagged.extra_fields).possible_duplicate_of.ref, 'MK-20261024-400346');
  assert.match(tagged.moderation_reason, /^Possible duplicate of MK-20261024-400346/);
  assert.equal(withPossibleDuplicateOf(newListing, null), newListing);

  const failing = { async query(sql) { calls.push(String(sql)); if (sql === DUPLICATE_CANDIDATES_SQL) throw new Error('timeout'); return { rows: [] }; } };
  assert.equal(await possibleDuplicateOfNewListing(failing, newListing), null, 'a failed lookup never blocks the harvest');
  assert.ok(calls.includes('ROLLBACK TO SAVEPOINT possible_duplicate_check'));
});

test('bulk approval holds a cross-video duplicate; the staff preview links it', () => {
  const { staffBulkDuplicateMatch, buildApprovedDuplicateIndex, staffPossibleDuplicateOf } = require('../routes/staff')._test;
  const index = buildApprovedDuplicateIndex([plot400346]);
  const pending = { ...plot67E51F, lister_phone: '', extra_fields: { source_url: plot67E51F.source_url } };
  const match = staffBulkDuplicateMatch(pending, index);
  assert.equal(match?.inquiry_reference, 'MK-20261024-400346');
  const dup = staffPossibleDuplicateOf(classifyDuplicates(plot67E51F, [plot400346]), {});
  assert.equal(dup.warning, 'Possible duplicate of MK-20261024-400346');
  assert.equal(dup.review_url, '/staff-dashboard/review/2a4353f2-6bd9-4c59-bbd1-ad7ed797488f');
  const stored = staffPossibleDuplicateOf([], { possible_duplicate_of: { id: plot400346.id, ref: 'MK-20261024-400346', reason: 'x' } });
  assert.equal(stored.ref, 'MK-20261024-400346');
  assert.equal(staffPossibleDuplicateOf([], {}), null);
  const app = read('assets/makaug-app.js');
  assert.match(app, /function staffPossibleDuplicateOfHtml/);
  assert.match(app, /Possible duplicate of <a href/);
  assert.match(app, /staffPossibleDuplicateOfHtml\(item\.extra_fields\?\.possible_duplicate_of\)/);
  assert.match(app, /staffPossibleDuplicateOfHtml\(duplicates\.possible_duplicate_of\)/);
});
