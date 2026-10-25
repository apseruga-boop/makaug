'use strict';

// Marketplace directory redesign (hybrid of options B and C, 25 Oct 2026):
// compact rows, "Who do you need?" search, the "What do you need help with?" panel,
// the interleaved default sort, branch counts, and clean-up migration 181.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const service = require('../services/marketplaceService');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'assets/makaug-app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ROUTE = fs.readFileSync(path.join(ROOT, 'routes/marketplace.js'), 'utf8');
const MIGRATIONS = path.join(ROOT, 'db/migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '181_marketplace_directory_cleanup.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'scripts/rollback-181-marketplace-directory-cleanup.sql'), 'utf8');
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

// Rows the clean-up must leave alone: the 15 "review" proposals and La'Bos Laundry.
const EXCLUDED = [
  '0633da18-02dc-455e-ae3a-825aca62ea8b', '38518211-4e45-4dca-a3f1-3acb23c815f3', '3cc94341-f76c-40ba-9d07-0208876e9e1b',
  '3d35bb9c-8b25-4292-8e84-5b86e45cd93b', '571736f5-1a28-4b80-9094-8a0b4cd2a698', '6696d68f-b640-43ff-b16d-144fec6e4a9e',
  '828414fa-a51a-4fd6-878b-48af88444386', '8bce5df4-d5fd-4e41-acf2-d1edf4e4160f', '8da29d2f-3371-4302-a145-b7c8ecb6165a',
  '973269d6-7af4-4d79-9fb1-b908e71fa708', '99a9f630-83f7-473e-9678-92c642ddf8a8', 'a40f543e-aa92-4c58-a3a8-8f50269104f6',
  'c2ba2cb7-3073-4605-9c1c-9f0d6642738a', 'c7e935f1-1cb4-4811-842a-50643472948f', 'd65b412b-8a89-43aa-931e-d57f162b973f',
  'dfdf0682-f3fa-4a4e-a75b-172f65551570'
];
const UNIFI = { primary: '7b244ef7-2c10-4deb-ad18-b0f64f0a0067', jinja: 'db10b9d8-7e0d-4806-8bb7-3233db92fddc', lira: 'd1ac2dfa-b0aa-4404-8f12-1ad95a733e1d', mbarara: 'c9f0c3e7-67b9-4aba-b04c-7fe3907ba738' };

function planRows() {
  return [...SQL.matchAll(/^ {2}\('([0-9a-f-]{36})'::uuid, (.*)\)[,;]?$/gm)].map((match) => {
    const fields = match[2].match(/'(?:[^']|'')*'|NULL|TRUE|FALSE/g).map((value) => (value === 'NULL' ? null : value === 'TRUE' ? true : value === 'FALSE' ? false : value.slice(1, -1).replace(/''/g, "'")));
    const [expectedName, expectedCategory, newName, newCategory, hideReason, branchGroupKey, branchPrimary] = fields;
    return { id: match[1], expectedName, expectedCategory, newName, newCategory, hideReason, branchGroupKey, branchPrimary };
  });
}

function fakeDb(rows = []) {
  const calls = [];
  return { calls, query: async (text, params) => { calls.push({ text, params }); return { rows }; } };
}

// ---------------------------------------------------------------- groups and counts

test('every category sits in exactly one panel group, and the groups follow the hybrid brief', () => {
  const keys = service.MARKETPLACE_CATEGORIES.map((item) => item.key);
  const grouped = service.MARKETPLACE_CATEGORY_GROUPS.flatMap((group) => group.categories);
  assert.deepEqual([...grouped].sort(), [...keys].sort());
  assert.equal(new Set(grouped).size, grouped.length);
  assert.deepEqual(service.MARKETPLACE_CATEGORY_GROUPS.map((group) => group.key), ['buy_sell_legal', 'build_design', 'power_water_security', 'manage_move_insure']);
  assert.ok(keys.includes('loans_microfinance'));
  assert.deepEqual([...service.MARKETPLACE_CORE_ORDER].sort(), [...keys].sort());
  assert.deepEqual(service.MARKETPLACE_CORE_ORDER.slice(0, 4), ['brokers', 'property_lawyers', 'surveyors', 'builders']);
});

test('panel counts add the live category counts of each group', () => {
  const counts = { brokers: 230, property_lawyers: 117, surveyors: 89, valuers: 10, mortgage_providers: 4, loans_microfinance: 21, builders: 225, solar: 80, cleaning: 47, commercial_services: 0 };
  const groups = service.marketplaceGroupCounts(counts);
  const byKey = Object.fromEntries(groups.map((group) => [group.key, group]));
  assert.equal(byKey.buy_sell_legal.count, 471);
  assert.equal(byKey.build_design.count, 225);
  assert.equal(byKey.power_water_security.count, 80);
  assert.equal(byKey.manage_move_insure.count, 47);
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), Object.values(counts).reduce((a, b) => a + b, 0));
  assert.deepEqual(byKey.buy_sell_legal.categories.find((item) => item.key === 'loans_microfinance'), { key: 'loans_microfinance', count: 21 });
});

test('stats return by_group next to by_category', async () => {
  service.invalidateMarketplaceStats?.();
  const db = fakeDb([{ category: 'brokers', count: 3 }, { category: 'solar', count: 2 }, { category: 'cleaning', count: 1 }]);
  const stats = await service.getMarketplaceStats(db, { force: true });
  assert.equal(stats.total, 6);
  assert.equal(stats.by_group.find((group) => group.key === 'buy_sell_legal').count, 3);
  assert.equal(stats.by_group.find((group) => group.key === 'power_water_security').count, 2);
  assert.equal(stats.by_group.find((group) => group.key === 'manage_move_insure').count, 1);
});

test('the group filter is validated and becomes a category list in SQL', async () => {
  assert.equal(service.normalizeCategoryGroup('build_design'), 'build_design');
  assert.equal(service.normalizeCategoryGroup('Build design'), 'build_design');
  assert.equal(service.normalizeCategoryGroup('nope'), '');
  assert.deepEqual(service.validateMarketplaceFilters({ group: 'nope' }).errors, ['Unknown marketplace service group.']);
  assert.equal(service.validateMarketplaceFilters({ group: 'power_water_security' }).ok, true);
  const db = fakeDb([]);
  await service.searchMarketplace(db, { group: 'build_design', page: 1, limit: 20 });
  const call = db.calls.at(-1);
  assert.match(call.text, /category = ANY\(\$\d+::text\[\]\)/);
  assert.ok(call.params.some((value) => Array.isArray(value) && value.join() === 'builders,architects,developers,interior_design,painters'));
});

test('the default sort interleaves categories, core property services first, after tier and rating', async () => {
  const db = fakeDb([]);
  await service.searchMarketplace(db, { page: 1, limit: 20, district: 'Gulu' });
  const { text, params } = db.calls.at(-1);
  const order = text.slice(text.indexOf('ORDER BY'));
  const at = (pattern) => order.search(pattern);
  assert.ok(at(/text_match DESC/) < at(/CASE tier/));
  assert.ok(at(/CASE tier/) < at(/rating_avg DESC/));
  assert.ok(at(/rating_count DESC/) < at(/category_rank ASC/));
  assert.ok(at(/category_rank ASC/) < at(/array_position/));
  assert.doesNotMatch(order.split('LIMIT')[0], /updated_at DESC/);
  assert.match(text, /ROW_NUMBER\(\) OVER \(PARTITION BY category ORDER BY \(COALESCE\(website, ''\) <> ''\) DESC/);
  assert.ok(params.some((value) => Array.isArray(value) && value[0] === 'brokers' && value.length === service.MARKETPLACE_CORE_ORDER.length));
  assert.match(text, /COALESCE\(branches\.branch_count, 1\)::int AS branch_count/);
  assert.match(text, /branch\.status = 'hidden' AND branch\.district = \$/);
});

test('"Who do you need?" uses prefix words and also matches the hinted trade', async () => {
  assert.equal(service.marketplaceTextQuery('land lawyer in Wakiso'), 'land:* & lawyer:* & wakiso:*');
  assert.equal(service.marketplaceTextQuery("O'Brien & co!!"), 'o:* & brien:* & co:*');
  assert.equal(service.marketplaceTextQuery('   '), '');
  const db = fakeDb([]);
  await service.searchMarketplace(db, { q: 'surveyor kampala', page: 1, limit: 20 });
  const { text, params } = db.calls.at(-1);
  assert.match(text, /\(category = \$\d+ OR to_tsvector/);
  assert.ok(params.includes('surveyors'));
  assert.ok(params.includes('surveyor:* & kampala:*'));
});

test('search rows drop internal columns and the route adds branch_count', async () => {
  const db = fakeDb([{ id: 'a', name: 'A', total_count: 1, category_rank: 1, branch_group_key: 'unifi', text_match: true, branch_count: 4 }]);
  const result = await service.searchMarketplace(db, { page: 1, limit: 20, tier: 'private' });
  assert.deepEqual(Object.keys(result.businesses[0]).sort(), ['branch_count', 'id', 'name']);
  assert.match(ROUTE, /branch_count: Math\.max\(1, Number\(row\.branch_count\) \|\| 1\)/);
  assert.match(ROUTE, /category_groups: MARKETPLACE_CATEGORY_GROUPS/);
});

// ---------------------------------------------------------------- front end

function loadFrontEnd(state) {
  const pick = (name) => {
    const start = APP.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    let depth = 0;
    for (let i = APP.indexOf(') {', start) + 2; i < APP.length; i += 1) {
      if (APP[i] === '{') depth += 1;
      if (APP[i] === '}' && --depth === 0) return APP.slice(start, i + 1);
    }
    throw new Error(name);
  };
  const constant = (name) => APP.slice(APP.indexOf(`const ${name} =`), APP.indexOf('});', APP.indexOf(`const ${name} =`)) + 3);
  const html = { tiles: '', chips: '' };
  const context = {
    currentLang: 'en', marketplaceState: state, html,
    document: { getElementById: (id) => (id === 'mkc-groups' ? { set innerHTML(v) { html.tiles = v; } } : id === 'marketplace-category-chips' ? { set innerHTML(v) { html.chips = v; } } : null) },
    cleanText: (value) => String(value ?? '').trim(),
    adminEscape: (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    adminAttr: (value) => String(value ?? '').replace(/"/g, '&quot;'),
    marketplaceCategoryStyle: () => ''
  };
  vm.createContext(context);
  vm.runInContext([
    constant('MARKETPLACE_UI_EN'), 'const MARKETPLACE_UI_OVERRIDES = {};', constant('MARKETPLACE_CATEGORY_LABELS'),
    pick('marketplaceTr'), pick('marketplaceCategoryLabel'), pick('marketplaceInterpolate'),
    APP.slice(APP.indexOf('const MARKETPLACE_NAME_KEEP_UPPER'), APP.indexOf('\n', APP.indexOf('const MARKETPLACE_NAME_KEEP_UPPER'))),
    pick('marketplaceDisplayName'), pick('marketplaceInitials'),
    constant('MARKETPLACE_GROUP_TITLE_KEYS'), pick('marketplaceGroupTitle'), pick('marketplaceGroupForCategory'),
    pick('marketplacePanelGroups'), pick('renderMarketplaceGroupPanel'), pick('renderMarketplaceCategoryChips'),
    'this.api = { marketplaceDisplayName, marketplaceInitials, marketplacePanelGroups, renderMarketplaceCategoryChips, marketplaceGroupForCategory };'
  ].join('\n'), context);
  return { ...context.api, html };
}

function panelState(overrides = {}) {
  return {
    categories: service.MARKETPLACE_CATEGORIES.map(({ key, label, icon }) => ({ key, label, icon })),
    categoryGroups: JSON.parse(JSON.stringify(service.MARKETPLACE_CATEGORY_GROUPS)),
    categoryCounts: { brokers: 230, builders: 225, architects: 40, solar: 80, cleaning: 47, loans_microfinance: 21, commercial_services: 0 },
    groupCounts: [], activeCategory: '', activeGroup: '', ...overrides
  };
}

test('the panel shows one tile per group with live counts and links to its busiest categories', () => {
  const fe = loadFrontEnd(panelState());
  const groups = fe.marketplacePanelGroups();
  assert.deepEqual(groups.map((group) => [group.key, group.count]), [['buy_sell_legal', 251], ['build_design', 265], ['power_water_security', 80], ['manage_move_insure', 47]]);
  fe.renderMarketplaceCategoryChips();
  assert.equal((fe.html.tiles.match(/class="mkc-tile"/g) || []).length, 4);
  assert.match(fe.html.tiles, /Build &amp; design/);
  assert.match(fe.html.tiles, /265 businesses/);
  assert.match(fe.html.tiles, /onclick="selectMarketplaceGroup\('build_design'\)"/);
  assert.match(fe.html.tiles, /onclick="selectMarketplaceCategory\('loans_microfinance'\)"[^>]*>.*Loans &amp; microfinance/);
  assert.doesNotMatch(fe.html.tiles, /commercial_services/, 'empty categories are not linked');
  // server counts win when present
  const served = loadFrontEnd(panelState({ groupCounts: [{ key: 'build_design', count: 399 }] }));
  assert.equal(served.marketplacePanelGroups().find((group) => group.key === 'build_design').count, 399);
});

test('clicking a group highlights its tile and narrows the chips to that group', () => {
  const fe = loadFrontEnd(panelState({ activeGroup: 'build_design' }));
  fe.renderMarketplaceCategoryChips();
  assert.match(fe.html.tiles, /data-group="build_design" aria-current="true"/);
  assert.match(fe.html.tiles, /data-group="buy_sell_legal" aria-current="false"/);
  assert.match(fe.html.chips, /All Build &amp; design/);
  assert.match(fe.html.chips, /Builders/);
  assert.doesNotMatch(fe.html.chips, /Brokers/);
  assert.match(fe.html.chips, /selectMarketplaceGroup\(''\)/);
  assert.equal(fe.marketplaceGroupForCategory('solar').key, 'power_water_security');
});

test('display names keep acronyms and avatars use initials, never photos of stock houses', () => {
  const fe = loadFrontEnd(panelState());
  assert.equal(fe.marketplaceDisplayName('KAMPALA TEACHERS SACCO LTD'), 'Kampala Teachers SACCO Ltd');
  assert.equal(fe.marketplaceDisplayName('NSSF HOUSE UAP TOWER'), 'NSSF House UAP Tower');
  assert.equal(fe.marketplaceDisplayName('Already Fine Ltd'), 'Already Fine Ltd');
  assert.equal(fe.marketplaceInitials('Costa Construction Services Ltd'), 'CC');
  assert.doesNotMatch(APP.slice(APP.indexOf('function marketplaceAvatarHtml'), APP.indexOf('function marketplaceWebsiteHost')), /unsplash|placeholder|stock/i);
});

test('page markup: panel on top, one "Who do you need?" search with district, Ask AI link, no sidebar or Get matched box', () => {
  const page = HTML.slice(HTML.indexOf('<div id="page-marketplace"'), HTML.indexOf('id="marketplace-results"'));
  assert.ok(page.indexOf('id="mkc-groups"') < page.indexOf('id="marketplace-filter-form"'));
  assert.match(page, /data-marketplace-i18n="panelTitle">What do you need help with\?/);
  assert.match(page, /data-marketplace-placeholder="whoPlaceholder"/);
  assert.match(page, /id="marketplace-district"/);
  assert.match(page, /data-marketplace-i18n="askAiLink"/);
  assert.doesNotMatch(page, /mkc-side|mkc-match|Get matched/);
  assert.match(HTML, /marketplace-directory-redesign-20261025/);
  for (const key of ['whoPlaceholder', 'askAiLink', 'branchesCount', 'panelTitle', 'groupBusinesses', 'allInGroup', 'listingNote']) {
    assert.match(APP, new RegExp(`${key}: "`), key);
  }
  assert.match(APP, /loans_microfinance: \{ en: "Loans & microfinance", lg: /);
  assert.match(APP, /loans_microfinance: \{ accent: "#a21caf"/);
  assert.doesNotMatch(APP, /MARKETPLACE_EXTRA_CATEGORY_LABELS/);
  assert.match(APP, /group: cleanText\(params\.get\("group"\) \|\| ""\)/);
  assert.match(APP, /function selectMarketplaceGroup\(groupKey\)/);
});

// ---------------------------------------------------------------- migration 181

test('migration 181 is the next free number and carries the reviewed plan, guards and backup', () => {
  const names = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
  assert.equal(names.filter((name) => name.startsWith('181_')).length, 1);
  const highest = Math.max(...names.map((name) => Number(name.slice(0, 3))).filter(Number.isFinite));
  assert.equal(highest, 181);
  assert.match(SQL, /SET LOCAL lock_timeout = '8s'/);
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS marketplace_cleanup_181_backup/);
  assert.match(SQL, /current_setting\('app\.country_code', true\)/);
  assert.doesNotMatch(SQL, /DELETE FROM marketplace_businesses/);
  const statements = SQL.replace(/--.*$/gm, '');
  assert.doesNotMatch(statements, /\b(latitude|longitude|area|district|properties)\s*=/, 'no location, map or property changes');
  assert.doesNotMatch(statements, /UPDATE\s+properties/i);
  const plan = planRows();
  assert.equal(plan.length, 404);
  assert.equal(new Set(plan.map((row) => row.id)).size, 404);
  for (const id of EXCLUDED) assert.ok(!plan.some((row) => row.id === id), `excluded ${id}`);
  assert.equal(plan.filter((row) => row.hideReason).length, 52);
  assert.equal(plan.filter((row) => row.newCategory).length, 47);
  assert.equal(plan.filter((row) => row.newName).length, 310);
  assert.equal(plan.filter((row) => row.branchGroupKey).length, 21);
  assert.equal(new Set(plan.filter((row) => row.branchGroupKey).map((row) => row.branchGroupKey)).size, 9);
  assert.equal(plan.filter((row) => row.branchPrimary).length, 9);
  assert.equal(plan.filter((row) => row.newCategory === 'loans_microfinance').length > 0, true);
  const valid = new Set(service.MARKETPLACE_CATEGORIES.map((item) => item.key));
  for (const row of plan) {
    if (row.newCategory) assert.ok(valid.has(row.newCategory), row.newCategory);
    if (row.newName) {
      assert.notEqual(row.newName, row.expectedName);
      assert.equal(row.newName.toLowerCase().replace(/[^a-z0-9]/g, '').length > 0, true);
    }
  }
  assert.match(ROLLBACK, /marketplace_cleanup_181_backup/);
  assert.match(ROLLBACK, /IS NOT DISTINCT FROM/);
  assert.match(ROLLBACK, /rolled_back_at/);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('migration 181 applies once, a second run changes nothing, and the rollback restores every row', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 180000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-181-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_181', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_181', database: 'postgres' });
    await client.connect();
    client.on('notice', (notice) => notices.push(notice.message || String(notice)));
    await client.query(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE payments (id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
    `);
    for (const name of fs.readdirSync(MIGRATIONS).filter((file) => /^08[1-4]_marketplace|^088_marketplace/.test(file)).sort()) {
      await client.query(fs.readFileSync(path.join(MIGRATIONS, name), 'utf8'));
    }
    const plan = planRows();
    const seed = async () => {
      await client.query('TRUNCATE marketplace_businesses CASCADE');
      for (const row of plan) {
        await client.query(
          `INSERT INTO marketplace_businesses (id, name, slug, category, district, phone, tier, status, source_type, source)
           VALUES ($1::uuid, $2, $1::text, $3, 'Kampala', '+256700000000', 'found_online', 'live', 'found_online', 'google_maps')`,
          [row.id, row.expectedName, row.expectedCategory]
        );
      }
      await client.query(`UPDATE marketplace_businesses SET district = 'Jinja' WHERE id = $1`, [UNIFI.jinja]);
      await client.query(`UPDATE marketplace_businesses SET district = 'Mbale' WHERE id = $1`, [UNIFI.primary]);
      await client.query(
        `INSERT INTO marketplace_businesses (id, name, slug, category, district, phone, tier, status, source_type, source)
         VALUES ($1::uuid, 'LA''BOS LAUNDRY AND CLEANING SERVICES', 'labos', 'cleaning', 'Gulu', '+256700000001', 'private', 'live', 'private', 'manual')`,
        [EXCLUDED[0]]
      );
    };
    const apply = async (text, country = 'UG') => {
      const before = notices.length;
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      await client.query(text);
      await client.query('COMMIT');
      return notices.slice(before).join('\n');
    };
    const snapshot = async () => (await client.query(
      `SELECT id, name, category, status, COALESCE(moderation_notes, '') AS notes FROM marketplace_businesses ORDER BY id`
    )).rows;

    await seed();
    const before = await snapshot();

    await t.test('another country is skipped', async () => {
      const notice = await apply(SQL, 'ZA');
      assert.match(notice, /skipped/);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('the first run makes exactly the planned changes', async () => {
      const notice = await apply(SQL);
      assert.match(notice, /marketplace_cleanup_181 targets=404 renamed=310 recategorised=47 hidden=52 grouped=21 folded=12/);
      const counts = (await client.query(`SELECT status, COUNT(*)::int AS n FROM marketplace_businesses GROUP BY status`)).rows;
      assert.deepEqual(Object.fromEntries(counts.map((row) => [row.status, row.n])), { live: 404 + 1 - 64, hidden: 64 });
      const labos = (await client.query('SELECT name, status FROM marketplace_businesses WHERE id = $1', [EXCLUDED[0]])).rows[0];
      assert.deepEqual(labos, { name: "LA'BOS LAUNDRY AND CLEANING SERVICES", status: 'live' });
      const loans = (await client.query(`SELECT COUNT(*)::int AS n FROM marketplace_businesses WHERE category = 'loans_microfinance'`)).rows[0].n;
      assert.ok(loans > 0);
      const hidden = (await client.query(`SELECT moderation_notes FROM marketplace_businesses WHERE status = 'hidden' LIMIT 1`)).rows[0];
      assert.match(hidden.moderation_notes, /\[cleanup-181\]/);
    });

    await t.test('search counts branches and finds a set by a branch district', async () => {
      const db = { query: (text, params) => client.query(text, params) };
      service.invalidateMarketplaceStats?.();
      const all = await service.searchMarketplace(db, { q: 'unifi', page: 1, limit: 20 });
      const unifi = all.businesses.find((row) => row.id === UNIFI.primary);
      assert.equal(unifi.branch_count, 4);
      assert.ok(!all.businesses.some((row) => [UNIFI.jinja, UNIFI.lira, UNIFI.mbarara].includes(row.id)));
      const jinja = await service.searchMarketplace(db, { district: 'Jinja', group: 'buy_sell_legal', page: 1, limit: 50 });
      assert.ok(jinja.businesses.some((row) => row.id === UNIFI.primary));
      const firstPage = await service.searchMarketplace(db, { page: 1, limit: 20, tier: 'found_online' });
      const firstCategories = firstPage.businesses.slice(0, 4).map((row) => row.category);
      assert.deepEqual(firstCategories, ['brokers', 'property_lawyers', 'surveyors', 'builders']);
    });

    await t.test('a second run changes nothing', async () => {
      const after = await snapshot();
      const notice = await apply(SQL);
      assert.match(notice, /targets=0 renamed=0 recategorised=0 hidden=0 grouped=0 folded=0/);
      assert.deepEqual(await snapshot(), after);
    });

    await t.test('rollback restores every row but keeps later staff edits', async () => {
      const edited = plan.find((row) => row.newName && !row.hideReason && !row.branchGroupKey).id;
      await client.query(`UPDATE marketplace_businesses SET name = 'Edited by staff' WHERE id = $1`, [edited]);
      await apply(ROLLBACK);
      const restored = await snapshot();
      assert.deepEqual(restored.filter((row) => row.id !== edited), before.filter((row) => row.id !== edited));
      assert.equal(restored.find((row) => row.id === edited).name, 'Edited by staff');
      const open = (await client.query('SELECT COUNT(*)::int AS n FROM marketplace_cleanup_181_backup WHERE rolled_back_at IS NULL')).rows[0].n;
      assert.equal(open, 0);
      const grouped = (await client.query('SELECT COUNT(*)::int AS n FROM marketplace_businesses WHERE branch_group_key IS NOT NULL')).rows[0].n;
      assert.equal(grouped, 0);
    });

    await t.test('after a rollback the migration can be applied again', async () => {
      const notice = await apply(SQL);
      assert.match(notice, /targets=404 renamed=309 recategorised=47 hidden=52 grouped=21 folded=12/, 'the staff-edited name is left alone');
    });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
