'use strict';

require('dotenv').config();

const db = require('../config/database');
const country = require('../config/countries/southAfrica');

function sourceId(channel, query) {
  return `za-${channel}-${Buffer.from(query).toString('hex').slice(0, 32)}`;
}

async function tableColumns(table) {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function run() {
  if (String(process.env.COUNTRY_CODE || '').toUpperCase() !== 'ZA') {
    throw new Error('Refusing to seed the SA source registry without COUNTRY_CODE=ZA.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const columns = await tableColumns('property_source_registry');
  if (!columns.size) throw new Error('property_source_registry is not migrated.');

  const queries = [...country.sourceQueries, ...country.cityQueries];
  const rows = country.sourceChannels.flatMap((channel) => queries.map((query) => ({ channel, query })));
  let inserted = 0;
  for (const row of rows) {
    const values = {
      id: sourceId(row.channel, row.query),
      source_type: row.channel,
      source_name: row.query,
      source_url: '',
      active: true,
      country_code: 'ZA',
      search_query: row.query,
      priority: row.query.startsWith('#') ? 80 : 60,
      created_at: new Date(),
      updated_at: new Date()
    };
    const selected = Object.entries(values).filter(([column]) => columns.has(column));
    if (!selected.length || !columns.has('id')) continue;
    const names = selected.map(([column]) => column);
    const params = selected.map(([, value]) => value);
    const updates = names.filter((name) => !['id', 'created_at'].includes(name));
    await db.query(
      `INSERT INTO property_source_registry (${names.map((name) => `"${name}"`).join(', ')})
       VALUES (${params.map((_, index) => `$${index + 1}`).join(', ')})
       ON CONFLICT (id) DO UPDATE SET ${updates.map((name) => `"${name}" = EXCLUDED."${name}"`).join(', ')}`,
      params
    );
    inserted += 1;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, country_code: 'ZA', rows: inserted, auto_publish: false })}\n`);
  await db.pool.end();
}

run().catch(async (error) => {
  console.error(error.message);
  try { await db.pool.end(); } catch (_) {}
  process.exitCode = 1;
});
