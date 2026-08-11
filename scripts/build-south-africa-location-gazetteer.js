'use strict';

const fs = require('fs');
const path = require('path');

const ENDPOINT = process.env.SOUTH_AFRICA_GAZETTEER_ENDPOINT
  || 'https://services3.arcgis.com/GMycIhSIBQnnjV35/arcgis/rest/services/Census_2011_Sub_Places_of_South_Africa/FeatureServer/0/query';
const PAGE_SIZE = 2000;
const OUTPUT_PATH = path.resolve(__dirname, '..', 'utils', 'southAfricaLocationGazetteer.generated.json');
const EXPECTED_PROVINCES = new Set([
  'Western Cape', 'Eastern Cape', 'Northern Cape', 'Free State', 'KwaZulu-Natal',
  'North West', 'Gauteng', 'Mpumalanga', 'Limpopo'
]);

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanSuburbName(value = '') {
  return compact(value)
    .replace(/\s+SP$/i, '')
    .replace(/\s+NU$/i, '')
    .trim();
}

async function request(params) {
  const url = new URL(ENDPOINT);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    headers: { 'User-Agent': 'seshaikhaya-gazetteer-builder/1.0' },
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`Stats SA gazetteer request failed: ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Stats SA gazetteer error: ${payload.error.message || 'unknown'}`);
  return payload;
}

async function build() {
  const countPayload = await request({ where: '1=1', returnCountOnly: true, f: 'json' });
  const total = Number(countPayload.count || 0);
  if (total < 10_000) throw new Error(`Stats SA gazetteer returned an implausible count: ${total}`);

  const rows = [];
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const payload = await request({
      where: '1=1',
      outFields: 'OBJECTID,SP_CODE,SP_NAME,MP_CODE,MP_NAME,MN_NAME,DC_NAME,PR_CODE,PR_NAME',
      returnGeometry: false,
      orderByFields: 'OBJECTID ASC',
      resultOffset: offset,
      resultRecordCount: PAGE_SIZE,
      f: 'json'
    });
    const features = Array.isArray(payload.features) ? payload.features : [];
    rows.push(...features.map((feature) => feature.attributes || {}));
    process.stdout.write(`Fetched ${Math.min(offset + features.length, total)} / ${total}\n`);
    if (!features.length) break;
  }

  const unique = new Map();
  for (const row of rows) {
    const code = compact(row.SP_CODE);
    const province = compact(row.PR_NAME);
    const city = compact(row.MP_NAME);
    const rawSuburb = compact(row.SP_NAME);
    const suburb = cleanSuburbName(rawSuburb);
    if (!code || !EXPECTED_PROVINCES.has(province) || !city || !suburb) continue;
    if (/^(?:no subplace|none|not applicable)$/i.test(suburb)) continue;
    unique.set(code, {
      code,
      province_code: compact(row.PR_CODE),
      province,
      city_code: compact(row.MP_CODE),
      city,
      suburb,
      source_name: rawSuburb,
      municipality: compact(row.MN_NAME),
      district_municipality: compact(row.DC_NAME)
    });
  }

  const locations = Array.from(unique.values()).sort((a, b) => (
    a.province.localeCompare(b.province)
    || a.city.localeCompare(b.city)
    || a.suburb.localeCompare(b.suburb)
    || a.code.localeCompare(b.code)
  ));
  const provinces = new Set(locations.map((item) => item.province));
  if (provinces.size !== EXPECTED_PROVINCES.size) {
    throw new Error(`Gazetteer province coverage failed: ${Array.from(provinces).join(', ')}`);
  }

  const payload = {
    source: {
      publisher: 'Statistics South Africa',
      dataset: 'Census 2011 Subplace boundaries',
      service_host: 'UCT Libraries ArcGIS data service',
      service_url: ENDPOINT.replace(/\/query$/, ''),
      hierarchy: ['province', 'main_place', 'sub_place'],
      generated_at: new Date().toISOString(),
      records: locations.length
    },
    locations
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload)}\n`);
  process.stdout.write(`Wrote ${locations.length} South Africa canonical subplaces to ${OUTPUT_PATH}\n`);
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
