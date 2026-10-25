'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { humanPropertyTypeLabel } = require('../utils/commercialClassification');
const { canonicalDisplayLocationForRow } = require('../utils/ugandaLocationRegistry');
const { cleanListingTitle } = require('../services/publicListingCopy');
const { PROPERTY_TYPE_RULES } = require('../utils/propertyTypeVocabulary');
const { publicPropertyTypeLabel } = require('../routes/properties')._test;

const MIGRATION = path.join(__dirname, '../db/migrations/179_namuseera_stored_type.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-179-listing-corrections.sql');
const MIGRATIONS = path.join(__dirname, '../db/migrations');
const PROPERTIES_ROUTE = path.join(__dirname, '../routes/properties.js');
const NAMUSEERA = 'ee920882-bd61-4f1d-9156-75f45851edf9';
const DECOY = '00000000-0000-4000-8000-000000000179';
const LIVE_TITLE = 'Land for sale in Namuseera, Wakiso';
const LIVE_ADDRESS = 'Namuseera Estate, Namuseera, Wakiso';
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function updates(result) {
  return (Array.isArray(result) ? result : [result])
    .filter((item) => item && item.command === 'UPDATE')
    .reduce((sum, item) => sum + item.rowCount, 0);
}

function rowNotices(list) {
  return list.flatMap((message) => {
    const match = String(message).match(/^listing_correction_179 ([0-9a-f-]{36}) (applied|skipped) (\S+)/);
    return match ? [{ id: match[1], verb: match[2], reason: match[3], text: String(message) }] : [];
  });
}

function detailLocation(row) {
  const extra = row.extra_fields || {};
  const parts = [];
  for (const part of [row.area || extra.neighborhood || extra.city, extra.city, row.district]) {
    const value = String(part || '').trim();
    if (!value || parts.some((item) => item.toLowerCase() === value.toLowerCase())) continue;
    parts.push(value);
  }
  return parts.join(', ');
}

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

const sql = fs.readFileSync(MIGRATION, 'utf8');
const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8');
const propertiesSource = fs.readFileSync(PROPERTIES_ROUTE, 'utf8');

test('listing correction 179 matches the stored type code and records every display mapping', () => {
  const names = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
  assert.equal(names.includes('179_namuseera_stored_type.sql'), true);
  assert.equal(names.filter((name) => name.startsWith('179_')).length, 1);
  assert.match(sql, /SET LOCAL lock_timeout = '8s'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_correction_179_backup/);
  assert.match(sql, /DISABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /ENABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /current_setting\('app\.country_code', true\) IS NOT DISTINCT FROM 'UG'/);
  assert.match(sql, /IF NOT pg_temp\.listing_179_guard_country\(\)/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_179 % applied namuseera_location %'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_179 % skipped type_guard %'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_179 % skipped country_not_ug %'/);
  assert.match(sql, /listing_179_type_key\(p\.property_type\) NOT IN \('commercial_land', 'land'\)/);
  assert.match(sql, /\[\[:space:\]-\]\+/);
  assert.match(sql, /property_type = 'land'/);
  assert.match(sql, /area = 'Namuseera'/);
  assert.match(sql, /Namuseera, Wakiso/);
  assert.match(sql, /wakiso town/);
  assert.match(sql, new RegExp(NAMUSEERA));
  assert.match(sql, /property_type=%L area=%L city=%L neighborhood=%L label=%L district=%L status=%L title=%L listing_type=%L canonical=%L/);
  assert.doesNotMatch(sql, /property_type = 'Land'/);
  assert.doesNotMatch(sql, /property_type = 'Commercial land'/);
  assert.doesNotMatch(sql, /skipped area_guard/);
  assert.doesNotMatch(sql, /skipped city_guard/);
  assert.doesNotMatch(sql, /skipped title_guard/);
  assert.doesNotMatch(sql, /skipped neighborhood_guard/);
  assert.doesNotMatch(sql, /skipped label_guard/);
  assert.doesNotMatch(sql, /skipped canonical_guard/);
  assert.doesNotMatch(sql, /skipped listing_guard/);
  assert.doesNotMatch(sql, /36760196-c98d-41c9-b1e5-31e1417067c6/);
  assert.doesNotMatch(sql, /wakiso:namuseera/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+property_images/i);
  assert.doesNotMatch(sql, /routes\/whatsapp|services\/whatsapp/);
  assert.equal(fs.existsSync(ROLLBACK), true);
  assert.equal(fs.existsSync(path.join(MIGRATIONS, 'rollback-179-listing-corrections.sql')), false);
  assert.match(rollbackSql, /listing_correction_179_backup/);
  assert.match(rollbackSql, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.match(rollbackSql, /address = b\.before_row->>'address'/);
  assert.match(rollbackSql, /property_type = b\.before_row->>'property_type'/);
  assert.match(rollbackSql, /DISABLE TRIGGER trg_properties_updated_at/);
  assert.match(rollbackSql, /ENABLE TRIGGER trg_properties_updated_at/);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(rollbackSql, /DROP TABLE listing_correction_179_backup/i);
  assert.doesNotMatch(rollbackSql, /property_images/);

  const landRule = PROPERTY_TYPE_RULES.find((rule) => rule.physical_type === 'land');
  assert.equal(landRule.property_type, 'land');
  assert.equal(humanPropertyTypeLabel('commercial_land'), 'Commercial land');
  assert.equal(humanPropertyTypeLabel('land'), 'land');
  assert.equal(humanPropertyTypeLabel('Land'), 'Land');
  assert.equal(humanPropertyTypeLabel('Commercial land'), 'Commercial land');
  assert.equal(humanPropertyTypeLabel('LAND'), 'LAND');
  assert.equal(humanPropertyTypeLabel('commercial-land'), 'commercial-land');

  const storedLikeProduction = {
    title: LIVE_TITLE,
    listing_type: 'land',
    property_type: 'commercial_land',
    transaction_type: 'sale',
    status: 'approved',
    area: 'Wakiso',
    district: 'Wakiso',
    extra_fields: {
      canonical_location_id: 'wakiso:wakiso',
      canonical_location_level: 'district',
      city: 'Wakiso Town',
      neighborhood: 'Wakiso',
      resolved_location_label: 'From, Kampala, Central'
    }
  };
  const blanked = canonicalDisplayLocationForRow(storedLikeProduction);
  assert.equal(blanked.area, null);
  assert.equal(blanked.district, 'Wakiso');
  assert.equal(blanked.canonical.key, 'wakiso:wakiso');
  assert.equal(cleanListingTitle(storedLikeProduction), LIVE_TITLE);
  const shown = canonicalDisplayLocationForRow({
    ...storedLikeProduction,
    area: 'Namuseera',
    property_type: 'land'
  });
  assert.equal(shown.area, 'Namuseera');
  assert.equal(shown.district, 'Wakiso');
  assert.equal([shown.area, shown.district].filter(Boolean).join(', '), 'Namuseera, Wakiso');
  assert.equal(humanPropertyTypeLabel('land'), 'land');

  // The public rows capitalise the shared label, so the stored code 'land' reads "Land".
  assert.match(propertiesSource, /property_type:\s*publicPropertyTypeLabel\(row\.property_type\)/);
  assert.match(propertiesSource, /property_type:\s*publicPropertyTypeLabel\(safeProperty\.property_type\)/);
  assert.equal(publicPropertyTypeLabel('land'), 'Land');
  assert.equal(publicPropertyTypeLabel('commercial_land'), 'Commercial land');
  assert.match(propertiesSource, /city:\s*extra\.city\s*\|\|\s*null/);
  assert.match(propertiesSource, /neighborhood:\s*extra\.neighborhood\s*\|\|\s*null/);
  assert.match(propertiesSource, /resolved_location_label:\s*extra\.resolved_location_label\s*\|\|\s*null/);
  assert.match(propertiesSource, /listing_type:\s*row\.listing_type/);
  assert.doesNotMatch(propertiesSource, /status:\s*human/);
});

test('listing correction 179 applies the production code, skips with the values found, and rolls back', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 120000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-179-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_179', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_179', database: 'postgres' });
    await client.connect();
    client.on('notice', (notice) => notices.push(notice.message || String(notice)));
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`CREATE TABLE properties (
      id uuid PRIMARY KEY,
      title text,
      description text,
      listing_type text,
      transaction_type text,
      property_type text,
      status text,
      area text,
      district text,
      address text,
      price numeric,
      price_original numeric,
      price_currency text,
      price_unit text,
      price_period text,
      price_on_application boolean,
      land_size_value numeric,
      land_size_unit text,
      extra_fields jsonb,
      updated_at timestamptz,
      created_at timestamptz
    )`);
    await client.query(`CREATE TRIGGER trg_properties_updated_at
      BEFORE UPDATE ON properties
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

    async function apply(text, country = 'UG') {
      const before = notices.length;
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      const result = await client.query(text);
      return { result, notices: notices.slice(before) };
    }

    async function row(id) {
      const found = await client.query('SELECT * FROM properties WHERE id = $1', [id]);
      return found.rows[0];
    }

    async function seed(overrides = {}) {
      await client.query('DELETE FROM properties');
      await client.query('DROP TABLE IF EXISTS listing_correction_179_backup');
      const extra = {
        canonical_location_id: 'wakiso:wakiso',
        canonical_location_level: 'district',
        neighborhood: overrides.neighborhood === undefined ? 'Wakiso' : overrides.neighborhood,
        region: 'Central',
        resolved_location_label: overrides.label === undefined ? 'From, Kampala, Central' : overrides.label,
        location_resolution_status: 'canonical_human_confirmed'
      };
      if (overrides.city !== null) extra.city = overrides.city === undefined ? 'Wakiso Town' : overrides.city;
      const area = overrides.area === undefined ? 'Wakiso' : overrides.area;
      await client.query(
        `INSERT INTO properties (
           id, title, description, listing_type, transaction_type, property_type, status,
           area, district, address, price, price_currency, price_period, price_on_application,
           extra_fields, updated_at, created_at
         ) VALUES
         ($1, $2, 'Plots for sale in Namuseera Estate, Wakiso.', 'land', 'sale', $3, $4,
          $5, 'Wakiso', $6, 30000000, 'UGX', 'once', false, $7::jsonb, '2026-10-24T10:56:23.942Z', '2026-10-01T00:00:00Z'),
         ($8, 'Decoy land in Wakiso', 'Leave this row alone.', 'land', 'sale', 'commercial_land', 'approved',
          'Wakiso', 'Wakiso', 'Wakiso', 1000, 'UGX', 'once', false, $7::jsonb, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
        [
          NAMUSEERA,
          overrides.title || LIVE_TITLE,
          overrides.property_type || 'commercial_land',
          overrides.status || 'approved',
          area,
          LIVE_ADDRESS,
          JSON.stringify(extra),
          DECOY
        ]
      );
    }

    await t.test('the production code commercial_land is rewritten to land', async () => {
      await client.query('BEGIN');
      await seed();
      const before = await row(NAMUSEERA);
      assert.equal(before.property_type, 'commercial_land');
      assert.equal(humanPropertyTypeLabel(before.property_type), 'Commercial land');
      assert.equal(canonicalDisplayLocationForRow(before).area, null);
      assert.equal(detailLocation({ ...before, area: null }), 'Wakiso, Wakiso Town');

      const first = await apply(sql);
      const applied = rowNotices(first.notices);
      assert.equal(applied.length, 1, first.notices.join('\n'));
      assert.equal(applied[0].verb, 'applied');
      assert.equal(applied[0].reason, 'namuseera_location');
      assert.match(applied[0].text, /property_type='commercial_land'/);
      assert.match(applied[0].text, /area='Wakiso'/);
      assert.match(applied[0].text, /city='Wakiso Town'/);
      assert.match(applied[0].text, /neighborhood='Wakiso'/);
      assert.match(applied[0].text, /label='From, Kampala, Central'/);
      assert.match(applied[0].text, /district='Wakiso'/);
      assert.match(applied[0].text, /status='approved'/);
      assert.match(applied[0].text, /title='Land for sale in Namuseera, Wakiso'/);
      assert.match(applied[0].text, /listing_type='land'/);
      assert.match(applied[0].text, /canonical='wakiso:wakiso'/);

      const namuseera = await row(NAMUSEERA);
      assert.equal(namuseera.property_type, 'land');
      assert.equal(humanPropertyTypeLabel(namuseera.property_type), 'land');
      assert.equal(publicPropertyTypeLabel(namuseera.property_type), 'Land');
      assert.equal(namuseera.area, 'Namuseera');
      assert.equal(namuseera.district, 'Wakiso');
      assert.equal(namuseera.address, LIVE_ADDRESS);
      assert.equal(namuseera.title, LIVE_TITLE);
      assert.equal(namuseera.listing_type, 'land');
      assert.equal(namuseera.status, 'approved');
      assert.equal(namuseera.extra_fields.canonical_location_id, 'wakiso:wakiso');
      assert.equal(namuseera.extra_fields.neighborhood, 'Namuseera');
      assert.equal(namuseera.extra_fields.city, undefined);
      assert.equal(namuseera.extra_fields.resolved_location_label, 'Namuseera, Wakiso');
      assert.equal(namuseera.extra_fields.region, 'Central');
      assert.equal(detailLocation(namuseera), 'Namuseera, Wakiso');
      assert.equal([canonicalDisplayLocationForRow(namuseera).area, canonicalDisplayLocationForRow(namuseera).district].filter(Boolean).join(', '), 'Namuseera, Wakiso');
      assert.equal(namuseera.updated_at.toISOString(), new Date(namuseera.extra_fields.listing_correction_179.applied_at).toISOString());
      assert.ok(namuseera.extra_fields.listing_correction_179.actions.includes('namuseera_location'));
      const decoy = await row(DECOY);
      assert.equal(decoy.property_type, 'commercial_land');
      assert.equal(decoy.area, 'Wakiso');
      assert.equal(decoy.extra_fields.city, 'Wakiso Town');
      assert.equal(decoy.extra_fields.listing_correction_179, undefined);
      const stampedAt = namuseera.updated_at.toISOString();

      const second = await apply(sql);
      const skipped = rowNotices(second.notices);
      assert.equal(skipped.length, 1, second.notices.join('\n'));
      assert.equal(skipped[0].verb, 'skipped');
      assert.equal(skipped[0].reason, 'already_in_target_state');
      assert.match(skipped[0].text, /property_type='land'/);
      assert.match(skipped[0].text, /area='Namuseera'/);
      assert.match(skipped[0].text, /city=NULL/);
      assert.equal((await row(NAMUSEERA)).updated_at.toISOString(), stampedAt);
      assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM listing_correction_179_backup WHERE property_id = $1 AND row_kind = 'property'`, [NAMUSEERA])).rows[0].n, 1);

      const propertyUpdates = updates(await client.query(rollbackSql));
      assert.equal(propertyUpdates, 1);
      const restored = await row(NAMUSEERA);
      assert.equal(restored.property_type, 'commercial_land');
      assert.equal(restored.area, 'Wakiso');
      assert.equal(restored.title, LIVE_TITLE);
      assert.equal(restored.extra_fields.city, 'Wakiso Town');
      assert.equal(restored.extra_fields.neighborhood, 'Wakiso');
      assert.equal(restored.extra_fields.resolved_location_label, 'From, Kampala, Central');
      assert.equal(restored.extra_fields.listing_correction_179, undefined);
      assert.equal(restored.updated_at.toISOString(), '2026-10-24T10:56:23.942Z');
      assert.equal((await row(DECOY)).property_type, 'commercial_land');
      assert.equal((await client.query(`SELECT to_regclass('listing_correction_179_backup') AS name`)).rows[0].name, 'listing_correction_179_backup');
      await client.query('ROLLBACK');
    });

    await t.test('display labels and a different area or city still apply', async () => {
      for (const storedType of ['Commercial land', 'Land', 'LAND', 'commercial-land', 'Commercial_Land']) {
        await client.query('BEGIN');
        await seed({ property_type: storedType, area: 'Buloba', city: 'Kampala' });
        const result = await apply(sql);
        const note = rowNotices(result.notices).find((item) => item.id === NAMUSEERA);
        assert.equal(note && note.reason, 'namuseera_location', `${storedType}\n${result.notices.join('\n')}`);
        const after = await row(NAMUSEERA);
        assert.equal(after.property_type, 'land', storedType);
        assert.equal(after.area, 'Namuseera', storedType);
        assert.equal(after.extra_fields.city, 'Kampala', storedType);
        assert.equal(after.extra_fields.neighborhood, 'Namuseera');
        assert.equal((await row(DECOY)).area, 'Wakiso');
        await client.query('ROLLBACK');
      }

      await client.query('BEGIN');
      await seed({ property_type: 'commercial_land', area: null, city: 'WAKISO TOWN' });
      const folded = await apply(sql);
      assert.equal(rowNotices(folded.notices)[0].reason, 'namuseera_location');
      const foldedRow = await row(NAMUSEERA);
      assert.equal(foldedRow.area, 'Namuseera');
      assert.equal(foldedRow.property_type, 'land');
      assert.equal(foldedRow.extra_fields.city, undefined);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed({ property_type: 'land', area: 'Namuseera Estate', city: 'Wakiso' });
      const plainCity = await apply(sql);
      assert.equal(rowNotices(plainCity.notices)[0].reason, 'namuseera_location');
      const kept = await row(NAMUSEERA);
      assert.equal(kept.property_type, 'land');
      assert.equal(kept.area, 'Namuseera');
      assert.equal(kept.extra_fields.city, 'Wakiso');
      await client.query('ROLLBACK');
    });

    await t.test('a type outside the code list is skipped with the stored values', async () => {
      await client.query('BEGIN');
      await seed({ property_type: 'office', area: 'Kira', city: 'Kampala' });
      const guarded = await apply(sql);
      const note = rowNotices(guarded.notices).find((item) => item.id === NAMUSEERA);
      assert.equal(note.verb, 'skipped');
      assert.equal(note.reason, 'type_guard');
      assert.match(note.text, /property_type='office'/);
      assert.match(note.text, /area='Kira'/);
      assert.match(note.text, /city='Kampala'/);
      assert.match(note.text, /neighborhood='Wakiso'/);
      assert.match(note.text, /label='From, Kampala, Central'/);
      assert.match(note.text, /district='Wakiso'/);
      assert.match(note.text, /status='approved'/);
      assert.match(note.text, /title='Land for sale in Namuseera, Wakiso'/);
      assert.match(note.text, /listing_type='land'/);
      assert.match(note.text, /canonical='wakiso:wakiso'/);
      assert.equal((await row(NAMUSEERA)).property_type, 'office');
      assert.equal((await row(NAMUSEERA)).area, 'Kira');
      assert.equal((await row(NAMUSEERA)).extra_fields.city, 'Kampala');
      assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM listing_correction_179_backup`)).rows[0].n, 0);
      await client.query('ROLLBACK');
    });

    await t.test('another country, a deleted row, and a missing row are skipped with the values found', async () => {
      await client.query('BEGIN');
      await seed();
      const other = await apply(sql, 'ZA');
      const countryNote = rowNotices(other.notices).find((item) => item.id === NAMUSEERA);
      assert.equal(countryNote.reason, 'country_not_ug');
      assert.match(countryNote.text, /property_type='commercial_land'/);
      assert.match(countryNote.text, /area='Wakiso'/);
      assert.match(countryNote.text, /city='Wakiso Town'/);
      assert.equal((await row(NAMUSEERA)).property_type, 'commercial_land');
      assert.equal((await row(NAMUSEERA)).area, 'Wakiso');
      assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM listing_correction_179_backup`)).rows[0].n, 0);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed({ status: 'deleted' });
      const deleted = await apply(sql);
      const deletedNote = rowNotices(deleted.notices).find((item) => item.id === NAMUSEERA);
      assert.equal(deletedNote.reason, 'deleted');
      assert.match(deletedNote.text, /status='deleted'/);
      assert.match(deletedNote.text, /property_type='commercial_land'/);
      assert.equal((await row(NAMUSEERA)).area, 'Wakiso');
      assert.equal((await row(NAMUSEERA)).property_type, 'commercial_land');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed({ status: 'purged', property_type: 'land', area: 'Namuseera' });
      const purged = await apply(sql);
      const purgedNote = rowNotices(purged.notices).find((item) => item.id === NAMUSEERA);
      assert.equal(purgedNote.reason, 'deleted');
      assert.match(purgedNote.text, /status='purged'/);
      assert.equal((await row(NAMUSEERA)).area, 'Namuseera');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed();
      await client.query('DELETE FROM properties WHERE id = $1', [NAMUSEERA]);
      const missing = await apply(sql);
      const missingNote = rowNotices(missing.notices).find((item) => item.id === NAMUSEERA);
      assert.equal(missingNote.reason, 'missing');
      assert.match(missingNote.text, /property_type=NULL/);
      assert.match(missingNote.text, /area=NULL/);
      assert.match(missingNote.text, /city=NULL/);
      assert.equal(await row(NAMUSEERA), undefined);
      assert.equal((await row(DECOY)).property_type, 'commercial_land');
      await client.query('ROLLBACK');
    });
  } finally {
    if (client) {
      await client.end().catch(() => {});
    }
    if (started) {
      execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    }
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
