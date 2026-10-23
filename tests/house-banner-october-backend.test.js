'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const catalog = require('../services/advertisingCatalogService');

const ROOT = path.join(__dirname, '..');
const EXPECTED = [
  ['home-featured', 'home-hero', 'Every property in Uganda, in one place.', 'Search homes, land and rentals by area.'],
  ['home-brokers', 'agents', 'Talk to an agent who knows the area.', 'Open an agent profile and message them direct.'],
  ['sale-grid', 'sale', 'Search by neighbourhood.', 'Filter by area, bedrooms and property type.'],
  ['rent-grid', 'rent', 'Get new rentals first.', 'Tap Save search on any results page.'],
  ['student-grid', 'students', 'Find a room near your campus.', 'Search hostels and rooms by university area.'],
  ['commercial-grid', 'commercial', 'Shops and offices, one search.', 'Filter by town and type of space.'],
  ['land-grid', 'land', 'Walk the plot first.', 'Read our land safety tips, then visit with the seller.'],
  ['marketplace-results', 'marketplace', 'Find surveyors, lawyers and builders.', 'Browse property services by area and specialty.'],
  ['brokers-grid', 'brokers', 'Agents who know the area.', 'Open a profile to see their current listings.'],
  ['mortgage-results', 'mortgage', 'Plan your home loan before you view.', 'Use the repayment calculator to compare lenders.'],
  ['property-detail', 'detail', 'Like it? Ask on WhatsApp.', 'WhatsApp 0780 863 394 with the listing link.']
];

function handlerFromRoute(file, start, end, context) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'route boundaries must exist');
  let handler;
  const register = (_route, callback) => { handler = callback; };
  vm.runInNewContext(source.slice(startIndex, endIndex), {
    router: { get: register, patch: register },
    ...catalog,
    ...context
  });
  return handler;
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('catalog exposes all eleven October headlines, optional sublines and retained image paths', () => {
  assert.equal(catalog.getAdvertisingPlacements().length, EXPECTED.length);
  for (const [key, image, headline, subline] of EXPECTED) {
    const placement = catalog.findAdvertisingPlacement(key);
    assert.equal(placement.headline, headline);
    assert.equal(placement.subline, subline);
    assert.equal(placement.preview_image_url, `/assets/house-ads-v3/${image}.webp`);
    assert.equal(placement.background_position, key === 'commercial-grid' ? 'right center' : 'left center');
    assert.equal(placement.copy_side, key === 'commercial-grid' ? 'left' : 'right');
  }
  assert.equal(catalog.mergePlacementWithCatalog({ key: 'sale-grid' }).subline, EXPECTED[2][3], 'old rows without the optional field retain the fallback');
  assert.equal(catalog.mergePlacementWithCatalog({ key: 'sale-grid', subline: null }).subline, null, 'explicit null clears the subline');
  assert.equal(catalog.mergePlacementWithCatalog({ key: 'sale-grid', subline: '' }).subline, '', 'explicit blank clears the subline');
});

test('public placement API carries configured sublines and keeps the legacy-schema fallback', async () => {
  const configured = [{ key: 'sale-grid', subline: 'A staff subline.' }];
  const handler = handlerFromRoute('routes/advertising.js', "router.get('/placements'", "router.get('/dashboard'", {
    db: { query: async () => ({ rows: configured }) }
  });
  const res = response();
  await handler({}, res, (error) => { throw error; });
  assert.equal(res.body.data.find((row) => row.key === 'sale-grid').subline, 'A staff subline.');

  const fallbackHandler = handlerFromRoute('routes/advertising.js', "router.get('/placements'", "router.get('/dashboard'", {
    db: { query: async () => { throw Object.assign(new Error('missing column'), { code: '42703' }); } }
  });
  const fallback = response();
  await fallbackHandler({}, fallback, (error) => { throw error; });
  assert.equal(fallback.body.meta.fallback, true);
  assert.equal(fallback.body.data.find((row) => row.key === 'sale-grid').subline, EXPECTED[2][3]);
});

test('admin PATCH binds subline, trims text and permits clearing without touching omitted fields', async () => {
  const calls = [];
  const audits = [];
  const handler = handlerFromRoute('routes/admin.js', "router.patch('/advertising/placements/:key'", "router.get('/advertising/summary'", {
    db: {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{ key: values[values.length - 1], subline: values[0] }] };
      }
    },
    writeAudit: async (...args) => { audits.push(args); },
    adminActorId: () => 'test-admin'
  });
  for (const [input, expected] of [['  A smaller line.  ', 'A smaller line.'], ['', null], ['   ', null], [null, null]]) {
    const res = response();
    await handler({ params: { key: 'sale-grid' }, body: { subline: input } }, res, (error) => { throw error; });
    const call = calls[calls.length - 1];
    assert.match(call.sql, /SET subline = \$1,/);
    assert.doesNotMatch(call.sql, /headline =|preview_image_url =|base_price_ugx =|is_active =/);
    assert.equal(call.values[0], expected);
    assert.equal(call.values[1], 'sale-grid');
    assert.equal(res.body.data.subline, expected);
  }
  assert.equal(audits.length, 4);
  const empty = response();
  await handler({ params: { key: 'sale-grid' }, body: {} }, empty, (error) => { throw error; });
  assert.equal(empty.statusCode, 400);
  assert.equal(calls.length, 4, 'an omitted field must not update the row');
});

const PG_BIN = [process.env.HOUSE_BANNER_PG_BIN, '/opt/homebrew/opt/postgresql@16/bin', '/opt/homebrew/opt/postgresql@18/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean).find((dir) => ['initdb', 'pg_ctl', 'psql'].every((bin) => fs.existsSync(path.join(dir, bin))));

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

test('migration refreshes only Uganda house rows, preserves unrelated settings and is idempotent in PostgreSQL', {
  skip: PG_BIN ? false : 'PostgreSQL binaries are required for the isolated migration check.',
  timeout: 90000
}, async () => {
  const migration = fs.readFileSync(path.join(ROOT, 'db/migrations/167_house_banner_october_refresh.sql'), 'utf8');
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-house-banner-167-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let started = false;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=house_banner_test', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '15', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off`, 'start'], { stdio: 'pipe' });
    started = true;
    const sql = (statement) => execFileSync(path.join(PG_BIN, 'psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'house_banner_test', '-d', 'postgres'], { input: statement, encoding: 'utf8' }).trim();
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const fixtureRows = EXPECTED.map(([key]) => `(${quote(key)}, 'house_band', 'Happy Independence Day, Uganda.', '/old.webp', 'center center', 'left', 777, false, 'Keep CTA', '/keep', 'Keep notes', 99)`).join(',');
    sql(`CREATE TABLE advertising_placements (
      key text PRIMARY KEY, slot_type text, headline text, preview_image_url text,
      background_position text, copy_side text, base_price_ugx bigint, is_active boolean,
      cta_label text, cta_url text, notes text, sort_order integer,
      updated_at timestamptz DEFAULT '2026-10-09T00:00:00Z'
    );
    INSERT INTO advertising_placements (key,slot_type,headline,preview_image_url,background_position,copy_side,base_price_ugx,is_active,cta_label,cta_url,notes,sort_order)
      VALUES ${fixtureRows}, ('legacy-native','native','Unrelated','/keep.webp','center','right',555,true,'Other CTA','/other','Other notes',42);
    CREATE TABLE update_log (key text);
    CREATE FUNCTION record_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO update_log VALUES(NEW.key); RETURN NEW; END $$;
    CREATE TRIGGER count_updates BEFORE UPDATE ON advertising_placements FOR EACH ROW EXECUTE FUNCTION record_update();`);

    for (const country of ['ZA', '']) {
      const untouched = sql(`BEGIN; SELECT set_config('app.country_code', ${quote(country)}, true); ${migration}
        SELECT COUNT(*) FROM update_log; ROLLBACK;`).split('\n').filter(Boolean).at(-1);
      assert.equal(untouched, '0', `country ${country || 'unset'} must not update rows`);
    }

    const nonHouse = sql(`BEGIN; SET LOCAL app.country_code = 'UG';
      UPDATE advertising_placements SET slot_type = 'native' WHERE key = 'home-featured';
      TRUNCATE update_log; ${migration}
      SELECT jsonb_build_object('updates', (SELECT COUNT(*) FROM update_log),
        'headline', (SELECT headline FROM advertising_placements WHERE key = 'home-featured'));
      ROLLBACK;`);
    assert.deepEqual(JSON.parse(nonHouse), { updates: 10, headline: 'Happy Independence Day, Uganda.' }, 'a matching key must also remain a house band');

    sql(`BEGIN; SET LOCAL app.country_code = 'UG'; ${migration} COMMIT;`);
    const rows = JSON.parse(sql('SELECT jsonb_agg(to_jsonb(p) ORDER BY key) FROM advertising_placements p;'));
    assert.equal(sql('SELECT COUNT(*) FROM update_log;'), '11');
    for (const [key, image, headline, subline] of EXPECTED) {
      const row = rows.find((item) => item.key === key);
      assert.equal(row.headline, headline);
      assert.equal(row.subline, subline);
      assert.equal(row.preview_image_url, `/assets/house-ads-v3/${image}.webp`);
      assert.equal(row.background_position, key === 'commercial-grid' ? 'right center' : 'left center');
      assert.equal(row.copy_side, key === 'commercial-grid' ? 'left' : 'right');
      assert.equal(row.base_price_ugx, 777);
      assert.equal(row.is_active, false);
      assert.equal(row.cta_label, 'Keep CTA');
      assert.equal(row.cta_url, '/keep');
      assert.equal(row.notes, 'Keep notes');
      assert.equal(row.sort_order, 99);
    }
    const unrelated = rows.find((row) => row.key === 'legacy-native');
    assert.equal(unrelated.headline, 'Unrelated');
    assert.equal(unrelated.preview_image_url, '/keep.webp');
    assert.equal(unrelated.subline, null);
    assert.equal(new Date(unrelated.updated_at).toISOString(), '2026-10-09T00:00:00.000Z');
    sql(`BEGIN; SET LOCAL app.country_code = 'UG'; ${migration} COMMIT;`);
    assert.equal(sql('SELECT COUNT(*) FROM update_log;'), '11', 'a second application must not write unchanged banners');
  } finally {
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  }
});
