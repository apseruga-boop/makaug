'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const MIGRATION = path.join(__dirname, '../db/migrations/174_delete_hidden_duplicate_listings.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-174-duplicate-deletes.sql');
const MIGRATION_169 = path.join(__dirname, '../db/migrations/169_correct_mislabelled_listings_and_duplicates.sql');
const MIGRATION_170 = path.join(__dirname, '../db/migrations/170_correct_remaining_mislabelled_listings.sql');
const MIGRATION_172 = path.join(__dirname, '../db/migrations/172_correct_listings_skipped_by_170.sql');
const NAJJERA_KAZI = '31846e1b-167a-472b-b197-b16d48bed01b';
const NAJJERA_BRIAN = '7316f714-29eb-46fe-8bb2-2752108eed61';
const DELETED = '15ca0488-2702-4a93-8dd8-c30225d65c8d';
const DELETED_KEEPER = '250495cb-ddef-4499-a6d8-b977c2287193';
const DELETED_BARE = '42f256d4-24f7-4adb-82a0-7875caef88fc';
const DELETED_BARE_KEEPER = 'df969b6a-ff97-4ba8-ab3c-c70c8b184465';
const NOT_HIDDEN = '776cba37-0e45-49a4-b067-63819214ec7d';
const NOT_HIDDEN_KEEPER = 'f3bb5de0-b2c9-4502-9a06-d46bbaef0fcd';
const KEEPER_PRIVATE = '57344404-9f57-4030-8bb4-485e606da27e';
const KEEPER_PRIVATE_KEEPER = '723bb908-a360-47db-ae4a-b6e893693a6b';
const KEEPER_MISSING = '0df40bd8-98df-48ca-8855-a4b8cf186ef7';
const HALF_HIDDEN = 'c7c9e859-2c2a-429a-b565-3a27c4cc3d55';
const DECOY = '00000000-0000-4000-8000-000000000174';
const USER_ID = '00000000-0000-4000-8000-000000000175';
const IMAGE_ID = '00000000-0000-4000-8000-000000000176';
const CAPTION_ID = '00000000-0000-4000-8000-000000000177';
const INQUIRY_ID = '00000000-0000-4000-8000-000000000178';
const KEEPER_INQUIRY_ID = '00000000-0000-4000-8000-000000000179';
const BOOKING_ID = '00000000-0000-4000-8000-000000000180';
const FAVOURITE_ID = '00000000-0000-4000-8000-000000000181';
const KEEPER_FAVOURITE_ID = '00000000-0000-4000-8000-000000000182';
const EMAIL_ID = '00000000-0000-4000-8000-000000000183';
const WHATSAPP_LOG_ID = '00000000-0000-4000-8000-000000000184';
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin', '/opt/homebrew/opt/postgresql@16/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function loadSpecs(sql, tag) {
  const open = sql.indexOf(tag);
  assert.ok(open >= 0, `${tag} missing`);
  const from = open + tag.length;
  const close = sql.indexOf(tag, from);
  assert.ok(close > from, `${tag} is not closed`);
  return JSON.parse(sql.slice(from, close));
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

function parseNotices(list) {
  const rows = [];
  let deletedCount = null;
  let restoredCount = null;
  let country = false;
  for (const raw of list) {
    const message = String(raw).trim();
    let match = message.match(/^duplicate_delete_174 ([0-9a-f-]{36}) deleted$/);
    if (match) {
      rows.push({ id: match[1], verb: 'deleted', reason: '' });
      continue;
    }
    match = message.match(/^duplicate_delete_174 ([0-9a-f-]{36}) skipped (\S+)$/);
    if (match) {
      rows.push({ id: match[1], verb: 'skipped', reason: match[2] });
      continue;
    }
    match = message.match(/^duplicate_delete_174 deleted_count (\d+)$/);
    if (match) {
      deletedCount = Number(match[1]);
      continue;
    }
    match = message.match(/^rollback_174 restored_count (\d+)$/);
    if (match) {
      restoredCount = Number(match[1]);
      continue;
    }
    if (message === 'duplicate_delete_174 skipped country_not_ug' || message === 'rollback_174 skipped country_not_ug') {
      country = true;
    }
  }
  return { rows, deletedCount, restoredCount, country };
}

const sql = fs.readFileSync(MIGRATION, 'utf8');
const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8');
const specs = loadSpecs(sql, '$duplicate_delete_174$');
const specs169 = loadSpecs(fs.readFileSync(MIGRATION_169, 'utf8'), '$listing_corrections$');
const specs170 = loadSpecs(fs.readFileSync(MIGRATION_170, 'utf8'), '$listing_corrections_170$');
const specs172 = loadSpecs(fs.readFileSync(MIGRATION_172, 'utf8'), '$listing_corrections_172$');

test('duplicate delete 174 is the 49 hidden duplicates and refuses Najjera', () => {
  const unpublished169 = specs169.filter((spec) => spec.action === 'unpublish');
  const unpublished170 = specs170.filter((spec) => spec.action === 'unpublish');
  const unpublished172 = specs172.filter((spec) => spec.action === 'unpublish');
  const five = new Set(unpublished172.map((spec) => spec.id));
  assert.deepEqual(
    [...five].sort(),
    [
      '15ca0488-2702-4a93-8dd8-c30225d65c8d',
      '42f256d4-24f7-4adb-82a0-7875caef88fc',
      'c7c9e859-2c2a-429a-b565-3a27c4cc3d55',
      'c9ab858d-dcb5-4f05-bf62-86daa29b0721',
      'd1cf79a4-f7b7-4c86-b538-0e25423a5da2'
    ]
  );
  assert.equal(unpublished169.length, 49);
  assert.equal(unpublished169.filter((spec) => !five.has(spec.id)).length, 44);
  assert.equal(unpublished170.filter((spec) => !five.has(spec.id)).length, 10);
  assert.equal(specs.length, 49);
  assert.equal(new Set(specs.map((spec) => spec.id)).size, 49);
  const byId = new Map(unpublished169.map((spec) => [spec.id, spec.kept_id]));
  for (const spec of specs) {
    assert.equal(byId.get(spec.id), spec.kept_id, spec.id);
    assert.notEqual(spec.id, spec.kept_id);
    assert.equal(five.has(spec.id), spec.origin === '172', spec.id);
    if (unpublished170.some((item) => item.id === spec.id) && !five.has(spec.id)) {
      assert.equal(spec.origin, '170', spec.id);
    }
    if (!unpublished170.some((item) => item.id === spec.id)) {
      assert.equal(spec.origin, '169', spec.id);
    }
  }
  const payloadIds = new Set(specs.map((spec) => spec.id));
  assert.equal(payloadIds.has(NAJJERA_KAZI), false);
  assert.equal(payloadIds.has(NAJJERA_BRIAN), false);
  for (const spec of specs169.filter((item) => item.action === 'skip')) {
    assert.equal(payloadIds.has(spec.id), false, spec.id);
  }
  assert.match(sql, /31846e1b-167a-472b-b197-b16d48bed01b/);
  assert.match(sql, /7316f714-29eb-46fe-8bb2-2752108eed61/);
  assert.match(sql, /payload includes a protected Najjera listing/);
  assert.match(sql, /skipped protected_najjera/);
  assert.match(sql, /skipped not_hidden/);
  assert.match(sql, /skipped keeper_missing/);
  assert.match(sql, /skipped keeper_not_public/);
  assert.match(sql, /skipped missing/);
  assert.match(sql, /duplicate_delete_174 % deleted/);
  assert.match(sql, /duplicate_delete_174 deleted_count %/);
  assert.match(sql, /current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS deleted_duplicates_backup_174_properties/);
  assert.match(sql, /deleted_duplicates_backup_174_/);
  assert.match(sql, /DELETE FROM properties WHERE id = p\.id/);
  assert.match(sql, /'property_inquiries', 'property_id'/);
  assert.match(sql, /'viewing_bookings', 'listing_id'/);
  assert.match(sql, /'agent_booking_requests', 'listing_id'/);
  assert.doesNotMatch(sql, /'whatsapp_message_logs'/);
  assert.doesNotMatch(sql, /'saved_properties'/);
  assert.equal(fs.existsSync(ROLLBACK), true);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-174-duplicate-deletes.sql')), false);
  assert.equal(fs.readdirSync(path.join(__dirname, '../db/migrations')).some((name) => name.startsWith('173_')), false);
  assert.match(rollbackSql, /deleted_duplicates_backup_174_properties/);
  assert.match(rollbackSql, /current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG'/);
  assert.match(rollbackSql, /rollback_174 % restored/);
  assert.match(rollbackSql, /rollback_174 restored_count %/);
  assert.doesNotMatch(rollbackSql, /DROP TABLE(?! IF EXISTS pg_temp)/i);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+deleted_duplicates_backup_174/i);
});

test('duplicate delete 174 backs up, guards, deletes, and rolls back', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 120000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-174-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_174', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_174', database: 'postgres' });
    await client.connect();
    client.on('notice', (notice) => notices.push(notice.message || String(notice)));
    await client.query("SET TIME ZONE 'UTC'");
    await client.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY
      );
      CREATE TABLE properties (
        id uuid PRIMARY KEY,
        title text,
        status text,
        moderation_stage text,
        area text,
        extra_fields jsonb,
        updated_at timestamptz
      );
      CREATE TABLE property_images (
        id uuid PRIMARY KEY,
        property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        url text NOT NULL
      );
      CREATE TABLE property_image_captions (
        id uuid PRIMARY KEY,
        image_id uuid NOT NULL REFERENCES property_images(id) ON DELETE RESTRICT,
        property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
        caption text NOT NULL
      );
      CREATE TABLE property_inquiries (
        id uuid PRIMARY KEY,
        property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        contact_name text NOT NULL,
        message text
      );
      CREATE TABLE viewing_bookings (
        id uuid PRIMARY KEY,
        listing_id uuid REFERENCES properties(id) ON DELETE SET NULL,
        name text,
        status text
      );
      CREATE TABLE saved_properties (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        UNIQUE (user_id, property_id)
      );
      CREATE TABLE email_logs (
        id uuid PRIMARY KEY,
        related_listing_id uuid REFERENCES properties(id) ON DELETE SET NULL,
        subject text
      );
      CREATE TABLE whatsapp_message_logs (
        id uuid PRIMARY KEY,
        related_listing_id uuid REFERENCES properties(id) ON DELETE SET NULL,
        template_key text
      );
    `);
    await client.query('INSERT INTO users (id) VALUES ($1)', [USER_ID]);

    const insertProperty = async (id, title, status, moderationStage, area) => {
      await client.query(
        `INSERT INTO properties (id, title, status, moderation_stage, area, extra_fields, updated_at)
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, TIMESTAMPTZ '2026-10-20 00:00:00+00')`,
        [id, title, status, moderationStage, area]
      );
    };
    await insertProperty(DELETED_KEEPER, 'Apartment complex for sale in Naguru', 'approved', 'approved', 'Naguru');
    await insertProperty(DELETED, '3-bed property for sale in Naguru', 'hidden', 'hidden', 'Naguru');
    await insertProperty(DELETED_BARE_KEEPER, 'Commercial property in Kikyusa', 'live', 'approved', 'Luwero');
    await insertProperty(DELETED_BARE, 'Commercial property in Kikyusa', 'hidden', 'hidden', 'Kikyusa');
    await insertProperty(NOT_HIDDEN_KEEPER, 'Property for sale in Kiwatule', 'approved', 'approved', 'Kiwatule');
    await insertProperty(NOT_HIDDEN, 'Property for sale in Kiwatule', 'approved', 'approved', 'Kiwatule');
    await insertProperty(KEEPER_PRIVATE_KEEPER, 'Bungalow for sale in Kiwatule', 'draft', 'draft', 'Kiwatule');
    await insertProperty(KEEPER_PRIVATE, 'Bungalow for sale in Kiwatule', 'hidden', 'hidden', 'Kiwatule');
    await insertProperty(KEEPER_MISSING, 'House for sale in Kira', 'hidden', 'hidden', 'Kira');
    await insertProperty(HALF_HIDDEN, '3-bed property for sale in Naguru', 'hidden', 'approved', 'Naguru');
    await insertProperty(NAJJERA_KAZI, '5-Bed property for sale in Najjera', 'approved', 'approved', 'Najjera');
    await insertProperty(NAJJERA_BRIAN, 'House for sale in Najjera', 'hidden', 'hidden', 'Najjera');
    await insertProperty(DECOY, 'Decoy listing', 'hidden', 'hidden', 'Kampala');
    await client.query(
      'INSERT INTO property_images (id, property_id, url) VALUES ($1, $2, $3)',
      [IMAGE_ID, DELETED, 'https://example.test/duplicate.jpg']
    );
    await client.query(
      'INSERT INTO property_image_captions (id, image_id, property_id, caption) VALUES ($1, $2, $3, $4)',
      [CAPTION_ID, IMAGE_ID, DELETED, 'front of the block']
    );
    await client.query(
      'INSERT INTO property_inquiries (id, property_id, contact_name, message) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
      [INQUIRY_ID, DELETED, 'Amina', 'Is the duplicate still available?', KEEPER_INQUIRY_ID, DELETED_KEEPER, 'Peter', 'Asking about the live copy']
    );
    await client.query(
      'INSERT INTO viewing_bookings (id, listing_id, name, status) VALUES ($1, $2, $3, $4)',
      [BOOKING_ID, DELETED, 'Amina', 'requested']
    );
    await client.query(
      'INSERT INTO saved_properties (id, user_id, property_id) VALUES ($1, $2, $3), ($4, $2, $5)',
      [FAVOURITE_ID, USER_ID, DELETED, KEEPER_FAVOURITE_ID, DELETED_KEEPER]
    );
    await client.query(
      'INSERT INTO email_logs (id, related_listing_id, subject) VALUES ($1, $2, $3)',
      [EMAIL_ID, DELETED, 'enquiry copy']
    );
    await client.query(
      'INSERT INTO whatsapp_message_logs (id, related_listing_id, template_key) VALUES ($1, $2, $3)',
      [WHATSAPP_LOG_ID, DELETED, 'listing_follow_up']
    );

    const apply = async (country = 'UG') => {
      const from = notices.length;
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      await client.query(sql);
      return parseNotices(notices.slice(from));
    };
    const rollBack = async (country = 'UG') => {
      const from = notices.length;
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      await client.query(rollbackSql);
      return parseNotices(notices.slice(from));
    };
    const property = async (id) => (await client.query('SELECT * FROM properties WHERE id = $1', [id])).rows[0];

    await t.test('deletes only a hidden duplicate whose keeper is public', async () => {
      await client.query('BEGIN');
      try {
      const first = await apply();
      assert.equal(first.deletedCount, 2);
      assert.equal(first.rows.length, 49);
      assert.deepEqual(
        first.rows.filter((row) => row.verb === 'deleted').map((row) => row.id).sort(),
        [DELETED, DELETED_BARE].sort()
      );
      const reason = Object.fromEntries(first.rows.map((row) => [row.id, row.reason]));
      assert.equal(reason[NOT_HIDDEN], 'not_hidden');
      assert.equal(reason[HALF_HIDDEN], 'not_hidden');
      assert.equal(reason[KEEPER_PRIVATE], 'keeper_not_public');
      assert.equal(reason[KEEPER_MISSING], 'keeper_missing');
      assert.equal(first.rows.some((row) => row.id === NAJJERA_KAZI || row.id === NAJJERA_BRIAN), false);
      assert.equal(await property(DELETED), undefined);
      assert.equal(await property(DELETED_BARE), undefined);
      assert.equal((await property(DELETED_KEEPER)).status, 'approved');
      assert.equal((await property(DELETED_BARE_KEEPER)).status, 'live');
      assert.equal((await property(NOT_HIDDEN)).status, 'approved');
      assert.equal((await property(KEEPER_PRIVATE)).status, 'hidden');
      assert.equal((await property(KEEPER_MISSING)).title, 'House for sale in Kira');
      assert.equal((await property(HALF_HIDDEN)).moderation_stage, 'approved');
      assert.equal((await property(NAJJERA_KAZI)).status, 'approved');
      assert.equal((await property(NAJJERA_BRIAN)).area, 'Najjera');
      assert.equal((await property(NAJJERA_BRIAN)).status, 'hidden');
      assert.equal((await property(DECOY)).title, 'Decoy listing');

      const images = await client.query('SELECT id, property_id FROM property_images');
      assert.equal(images.rowCount, 0);
      const captions = await client.query('SELECT id FROM property_image_captions');
      assert.equal(captions.rowCount, 0);
      const inquiries = await client.query('SELECT id, property_id, message FROM property_inquiries ORDER BY id');
      assert.equal(inquiries.rowCount, 2);
      assert.equal(inquiries.rows.find((row) => row.id === INQUIRY_ID).property_id, DELETED_KEEPER);
      assert.equal(inquiries.rows.find((row) => row.id === KEEPER_INQUIRY_ID).property_id, DELETED_KEEPER);
      const booking = await client.query('SELECT listing_id FROM viewing_bookings WHERE id = $1', [BOOKING_ID]);
      assert.equal(booking.rows[0].listing_id, DELETED_KEEPER);
      const favourites = await client.query('SELECT id, property_id FROM saved_properties ORDER BY id');
      assert.deepEqual(favourites.rows, [{ id: KEEPER_FAVOURITE_ID, property_id: DELETED_KEEPER }]);
      const email = await client.query('SELECT related_listing_id FROM email_logs WHERE id = $1', [EMAIL_ID]);
      assert.equal(email.rows[0].related_listing_id, null);
      const whatsappLog = await client.query('SELECT related_listing_id, template_key FROM whatsapp_message_logs WHERE id = $1', [WHATSAPP_LOG_ID]);
      assert.equal(whatsappLog.rows[0].related_listing_id, null);
      assert.equal(whatsappLog.rows[0].template_key, 'listing_follow_up');

      const propertyBackup = await client.query(
        'SELECT property_id, kept_property_id, origin, before_row->>\'title\' AS title FROM deleted_duplicates_backup_174_properties ORDER BY property_id'
      );
      assert.deepEqual(
        propertyBackup.rows.map((row) => row.property_id),
        [DELETED, DELETED_BARE].sort()
      );
      assert.equal(propertyBackup.rows.find((row) => row.property_id === DELETED).kept_property_id, DELETED_KEEPER);
      assert.equal(propertyBackup.rows.find((row) => row.property_id === DELETED).origin, '172');
      assert.equal(propertyBackup.rows.find((row) => row.property_id === DELETED).title, '3-bed property for sale in Naguru');
      const imageBackup = await client.query("SELECT before_row->>'url' AS url, disposition FROM deleted_duplicates_backup_174_property_images");
      assert.deepEqual(imageBackup.rows, [{ url: 'https://example.test/duplicate.jpg', disposition: 'cascade_delete' }]);
      const captionBackup = await client.query('SELECT delete_rank, disposition FROM deleted_duplicates_backup_174_property_image_captions');
      assert.equal(captionBackup.rows[0].disposition, 'cascade_delete');
      assert.ok(Number(captionBackup.rows[0].delete_rank) > 0);
      const inquiryBackup = await client.query('SELECT disposition FROM deleted_duplicates_backup_174_property_inquiries');
      assert.deepEqual(inquiryBackup.rows, [{ disposition: 'repoint' }]);
      const bookingBackup = await client.query('SELECT disposition FROM deleted_duplicates_backup_174_viewing_bookings');
      assert.deepEqual(bookingBackup.rows, [{ disposition: 'repoint' }]);
      const favouriteBackup = await client.query('SELECT disposition FROM deleted_duplicates_backup_174_saved_properties');
      assert.deepEqual(favouriteBackup.rows, [{ disposition: 'cascade_delete' }]);
      const emailBackup = await client.query("SELECT disposition, before_row->>'related_listing_id' AS listing_id FROM deleted_duplicates_backup_174_email_logs");
      assert.equal(emailBackup.rows[0].disposition, 'set_null');
      assert.equal(emailBackup.rows[0].listing_id, DELETED);
      const whatsappBackup = await client.query('SELECT disposition FROM deleted_duplicates_backup_174_whatsapp_message_logs');
      assert.deepEqual(whatsappBackup.rows, [{ disposition: 'set_null' }]);
      const guarded = await client.query(
        'SELECT property_id FROM deleted_duplicates_backup_174_properties WHERE property_id = ANY($1::uuid[])',
        [[NOT_HIDDEN, KEEPER_PRIVATE, KEEPER_MISSING, HALF_HIDDEN, NAJJERA_KAZI, NAJJERA_BRIAN, DECOY]]
      );
      assert.equal(guarded.rowCount, 0);

      const second = await apply();
      assert.equal(second.deletedCount, 0);
      assert.equal(second.rows.filter((row) => row.verb === 'deleted').length, 0);
      assert.equal(second.rows.find((row) => row.id === DELETED).reason, 'missing');
      assert.equal(second.rows.find((row) => row.id === DELETED_BARE).reason, 'missing');
      assert.equal(second.rows.find((row) => row.id === NOT_HIDDEN).reason, 'not_hidden');
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM deleted_duplicates_backup_174_properties')).rows[0].n, 2);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM property_inquiries')).rows[0].n, 2);

      const restored = await rollBack();
      assert.equal(restored.restoredCount, 2);
      assert.equal((await property(DELETED)).title, '3-bed property for sale in Naguru');
      assert.equal((await property(DELETED)).status, 'hidden');
      assert.equal((await property(DELETED_BARE)).status, 'hidden');
      const imageAgain = await client.query('SELECT url, property_id FROM property_images WHERE id = $1', [IMAGE_ID]);
      assert.equal(imageAgain.rows[0].url, 'https://example.test/duplicate.jpg');
      assert.equal(imageAgain.rows[0].property_id, DELETED);
      const captionAgain = await client.query('SELECT caption, property_id, image_id FROM property_image_captions WHERE id = $1', [CAPTION_ID]);
      assert.equal(captionAgain.rows[0].caption, 'front of the block');
      assert.equal(captionAgain.rows[0].property_id, DELETED);
      assert.equal(captionAgain.rows[0].image_id, IMAGE_ID);
      const inquiryAgain = await client.query('SELECT property_id FROM property_inquiries WHERE id = $1', [INQUIRY_ID]);
      assert.equal(inquiryAgain.rows[0].property_id, DELETED);
      const keeperInquiry = await client.query('SELECT property_id, message FROM property_inquiries WHERE id = $1', [KEEPER_INQUIRY_ID]);
      assert.equal(keeperInquiry.rows[0].property_id, DELETED_KEEPER);
      assert.equal(keeperInquiry.rows[0].message, 'Asking about the live copy');
      const bookingAgain = await client.query('SELECT listing_id FROM viewing_bookings WHERE id = $1', [BOOKING_ID]);
      assert.equal(bookingAgain.rows[0].listing_id, DELETED);
      const favouritesAgain = await client.query('SELECT property_id FROM saved_properties ORDER BY property_id');
      assert.deepEqual(favouritesAgain.rows.map((row) => row.property_id).sort(), [DELETED, DELETED_KEEPER].sort());
      const emailAgain = await client.query('SELECT related_listing_id FROM email_logs WHERE id = $1', [EMAIL_ID]);
      assert.equal(emailAgain.rows[0].related_listing_id, DELETED);
      const whatsappAgain = await client.query('SELECT related_listing_id FROM whatsapp_message_logs WHERE id = $1', [WHATSAPP_LOG_ID]);
      assert.equal(whatsappAgain.rows[0].related_listing_id, DELETED);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM deleted_duplicates_backup_174_properties')).rows[0].n, 2);

      const restoredAgain = await rollBack();
      assert.equal(restoredAgain.restoredCount, 0);
      assert.equal((await property(DELETED)).title, '3-bed property for sale in Naguru');
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM property_images')).rows[0].n, 1);
      assert.equal((await client.query('SELECT property_id FROM property_inquiries WHERE id = $1', [INQUIRY_ID])).rows[0].property_id, DELETED);

      const third = await apply();
      assert.equal(third.deletedCount, 2);
      assert.equal(await property(DELETED), undefined);
      const restoredThird = await rollBack();
      assert.equal(restoredThird.restoredCount, 2);
      assert.equal((await property(DELETED)).status, 'hidden');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    await t.test('country guard deletes nothing and does not restore', async () => {
      await client.query('BEGIN');
      try {
      const blocked = await apply('ZA');
      assert.equal(blocked.country, true);
      assert.equal(blocked.deletedCount, 0);
      assert.equal(blocked.rows.length, 0);
      assert.equal((await property(DELETED)).status, 'hidden');
      assert.equal((await client.query("SELECT to_regclass('public.deleted_duplicates_backup_174_properties') AS name")).rows[0].name, null);
      const applied = await apply('UG');
      assert.equal(applied.deletedCount, 2);
      const blockedRollback = await rollBack('ZA');
      assert.equal(blockedRollback.country, true);
      assert.equal(blockedRollback.restoredCount, 0);
      assert.equal(await property(DELETED), undefined);
      const restored = await rollBack('UG');
      assert.equal(restored.restoredCount, 2);
      assert.equal((await property(DELETED)).title, '3-bed property for sale in Naguru');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    await t.test('an unpublished keeper and a republished duplicate are kept', async () => {
      await client.query('BEGIN');
      try {
      await client.query("UPDATE properties SET status = 'hidden', moderation_stage = 'hidden' WHERE id = $1", [DELETED_BARE_KEEPER]);
      await client.query("UPDATE properties SET status = 'approved', moderation_stage = 'approved' WHERE id = $1", [DELETED]);
      const result = await apply();
      assert.equal(result.rows.find((row) => row.id === DELETED).reason, 'not_hidden');
      assert.equal(result.rows.find((row) => row.id === DELETED_BARE).reason, 'keeper_not_public');
      assert.equal(result.deletedCount, 0);
      assert.equal((await property(DELETED)).status, 'approved');
      assert.equal((await property(DELETED_BARE)).status, 'hidden');
      assert.equal((await client.query('SELECT property_id FROM property_inquiries WHERE id = $1', [INQUIRY_ID])).rows[0].property_id, DELETED);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) {
      try {
        execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
      } catch (error) {
        fs.writeFileSync(path.join(cluster, 'stop-error.txt'), String(error.stderr || error.message || error));
      }
    }
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
