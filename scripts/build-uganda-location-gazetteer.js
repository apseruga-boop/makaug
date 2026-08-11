#!/usr/bin/env node

/**
 * Build Makaug's offline Uganda locality registry from UBOS's NPHC 2024
 * subcounty workbook. The workbook contains the full district -> county ->
 * subcounty/town council -> parish/ward hierarchy.
 *
 * The generated JSON is committed. Runtime resolution therefore has no
 * third-party network dependency.
 */

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DISTRICTS } = require('../utils/constants');

const SOURCE_URL = 'https://www.ubos.org/wp-content/uploads/2025/10/NPHC-2024-Subcounty-Profiles-Excel-Tables.xlsx';
const OUTPUT_PATH = path.join(__dirname, '..', 'utils', 'ugandaLocationGazetteer.generated.json');

// These styles identify hierarchy depth in the published UBOS workbook.
const STYLE_LEVEL = Object.freeze({
  21: 'district',
  18: 'county',
  19: 'subcounty',
  22: 'parish'
});

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedKey(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function workbookSharedStrings(xml) {
  return Array.from(String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((match) => (
    decodeXml(Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((part) => part[1]).join(''))
  ));
}

function columnARows(sheetXml, sharedStrings) {
  const rows = [];
  const cellPattern = /<c\b([^>]*)\br="A(\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
  for (const match of String(sheetXml).matchAll(cellPattern)) {
    const attributes = `${match[1]} ${match[3]}`;
    const style = Number(attributes.match(/\bs="(\d+)"/)?.[1]);
    const valueIndex = Number(match[4].match(/<v>([^<]*)<\/v>/)?.[1]);
    const value = Number.isInteger(valueIndex) ? sharedStrings[valueIndex] : '';
    if (STYLE_LEVEL[style] && clean(value)) rows.push({ value: clean(value), level: STYLE_LEVEL[style] });
  }
  return rows;
}

function humanize(value, level) {
  let result = clean(value);
  if (level === 'county') result = result.replace(/\s+COUNTY$/i, '');
  if (level === 'subcounty') {
    result = result
      .replace(/\s+SUB[- ]?COUNTY$/i, '')
      .replace(/\s+TOWN COUNCIL$/i, '')
      .replace(/\s+MUNICIPALITY$/i, '')
      .replace(/\s+DIVISION$/i, '');
  }
  if (level === 'parish') result = result.replace(/\s+(?:PARISH|WARD)$/i, '');
  return clean(result)
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, boundary, letter) => `${boundary}${letter.toUpperCase()}`);
}

function canonicalDistrict(value) {
  const key = normalizedKey(value);
  return DISTRICTS.find((district) => normalizedKey(district) === key) || '';
}

function canonicalLevel(raw, workbookLevel) {
  if (workbookLevel === 'county') return 'county';
  if (workbookLevel === 'parish') return /\bWARD$/i.test(raw) ? 'neighborhood' : 'parish';
  if (/\b(?:TOWN COUNCIL|MUNICIPALITY|DIVISION)$/i.test(raw)) return 'town';
  return 'subcounty';
}

async function downloadWorkbook(filePath) {
  const localInput = process.argv.find((arg) => arg.startsWith('--input='))?.slice('--input='.length);
  if (localInput) {
    fs.copyFileSync(path.resolve(localInput), filePath);
    return;
  }
  try {
    const response = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'makaug-location-registry-build/2.0' } });
    if (!response.ok) throw new Error(`UBOS workbook request failed (${response.status})`);
    fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    execFileSync('curl', ['-fLsS', '--max-time', '90', '-o', filePath, SOURCE_URL]);
  }
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-ubos-gazetteer-'));
  const workbookPath = path.join(tempDir, 'nphc-2024-subcounty-profiles.xlsx');
  try {
    await downloadWorkbook(workbookPath);
    const sharedXml = execFileSync('unzip', ['-p', workbookPath, 'xl/sharedStrings.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const tableOneXml = execFileSync('unzip', ['-p', workbookPath, 'xl/worksheets/sheet2.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const rows = columnARows(tableOneXml, workbookSharedStrings(sharedXml));
    const locations = [];
    let district = '';
    let subcounty = '';

    rows.forEach((row) => {
      if (row.level === 'district') {
        district = canonicalDistrict(row.value);
        subcounty = '';
        return;
      }
      if (!district) return;
      if (row.level === 'subcounty') subcounty = humanize(row.value, row.level);
      const name = humanize(row.value, row.level);
      if (!name || ['Central', 'Eastern', 'Northern', 'Western'].includes(name)) return;
      if (/\b(?:Road|Rd|Street|St|Avenue|Ave|Highway|Bypass|Expressway)\b/i.test(name)) return;
      const level = canonicalLevel(row.value, row.level);
      locations.push({
        name,
        district,
        town: row.level === 'parish' ? (subcounty || name) : name,
        level,
        aliases: Array.from(new Set([name, clean(row.value)])),
        source: 'ubos_nphc_2024_subcounty_profiles'
      });
    });

    const deduped = new Map();
    locations.forEach((row) => {
      const key = [normalizedKey(row.district), normalizedKey(row.name), row.level, normalizedKey(row.town)].join(':');
      if (!deduped.has(key)) deduped.set(key, row);
    });
    const payload = {
      meta: {
        source_name: 'Uganda Bureau of Statistics NPHC 2024 Subcounty Profiles',
        source_url: SOURCE_URL,
        source_release: '2025-10',
        source_sha256: crypto.createHash('sha256').update(fs.readFileSync(workbookPath)).digest('hex'),
        source_layers: ['County', 'Subcounty / Town Council', 'Parish / Ward'],
        runtime_network_dependency: false
      },
      locations: Array.from(deduped.values()).sort((a, b) => (
        a.district.localeCompare(b.district)
        || a.town.localeCompare(b.town)
        || a.name.localeCompare(b.name)
        || a.level.localeCompare(b.level)
      ))
    };
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(`Wrote ${payload.locations.length} UBOS canonical locality rows to ${OUTPUT_PATH}\n`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
