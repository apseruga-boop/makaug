'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PDFParse } = require('pdf-parse');
const { brochureBuffer } = require('../services/offPlanBrochureService');

const vanta = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/off-plan/vanta-house.development.json'), 'utf8'));

const velar = {
  country_code: 'KE',
  name: 'Velar',
  slug: 'velar',
  source_display_name: 'Karim - supplied Velar project renders',
  status: 'published',
  verification_status: 'partially_verified',
  description: 'Velar is a Kenya residential project presented in the supplied architectural renders with a tower, landscaped rooftop spaces and a rooftop pool. The exact location, developer identity, unit mix, prices, payment plan, programme, approvals and current availability were not included in the supplied pack and must be confirmed before any commitment or payment.',
  area: 'Location to be confirmed',
  district: 'Kenya',
  address: 'Kenya - exact project address to be confirmed',
  latitude: null,
  longitude: null,
  project_type: 'Residential development',
  original_currency: 'KES',
  unit_types: [{ key: 'residences', label: 'Residences - details to be confirmed', price_status: 'Current unit mix and prices to be confirmed with makaug.com' }],
  payment_plan: [],
  images: [
    { url: '/assets/off-plan/velar/tower-at-sunset.jpg', caption: 'Artist impression labelled Velar in the supplied Karim render pack', kind: 'artist_impression' },
    { url: '/assets/off-plan/velar/rooftop-overview.jpg', caption: 'Artist impression of a landscaped rooftop supplied for Velar', kind: 'artist_impression' },
    { url: '/assets/off-plan/velar/rooftop-pool.jpg', caption: 'Artist impression of a rooftop pool supplied for Velar', kind: 'artist_impression' }
  ],
  floor_plans: [],
  amenities: ['Landscaped rooftop shown in supplied renders', 'Rooftop pool shown in supplied renders'],
  nearby_places: [],
  extra_fields: {
    contact_mode: 'makaug_managed',
    country_name: 'Kenya',
    country_slug: 'kenya',
    area_overview: 'The supplied Velar pack contains architectural renders only. Confirm the county, neighbourhood, exact site entrance and travel times before visiting or making a commitment.',
    makaug_service_steps: ['Initial requirements and affordability call', 'Independent Kenyan lawyer and title checks'],
    public_preview_approved: true
  }
};

async function readPdf(pdf) {
  const parser = new PDFParse({ data: pdf });
  try {
    return await parser.getText();
  } finally {
    await parser.destroy();
  }
}

test('the public brochure is the editorial layout for Vanta House', async () => {
  const pdf = await brochureBuffer(vanta);
  const text = await readPdf(pdf);
  const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.equal(pages, 9);
  assert.match(text.text, /Vanta House/);
  assert.match(text.text, /makaug\.com/);
  assert.match(text.text, /USD 53,800/);
  assert.match(text.text, /John Yan/);
  assert.match(text.text, /OpenStreetMap contributors|Naguru/);
  assert.doesNotMatch(text.text, /To verify|Price on request|static map was unavailable/i);
  text.pages.forEach((page) => assert.ok(String(page.text || '').replace(/\s+/g, ' ').trim().length > 40));
});

test('a sparse project omits empty pages and placeholder lines', async () => {
  const pdf = await brochureBuffer(velar);
  const text = await readPdf(pdf);
  const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages >= 3 && pages <= 5, `expected a short brochure, got ${pages} pages`);
  assert.match(text.text, /Velar/);
  assert.match(text.text, /makaug\.com/);
  assert.match(text.text, /Landscaped rooftop/);
  assert.doesNotMatch(text.text, /to be confirmed|to verify|price on request|static map was unavailable|distance to confirm|floor plans/i);
  text.pages.forEach((page) => assert.ok(String(page.text || '').replace(/\s+/g, ' ').trim().length > 40));
});
