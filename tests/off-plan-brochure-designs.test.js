'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PDFParse } = require('pdf-parse');
const { brochureBuffer } = require('../services/offPlanBrochureService');
const { prepareModel } = require('../services/offPlanBrochureDesigns');

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

// Arthur, 14 Nov 2026: John Yan was to get the Vanta House brochure in
// English and in Luganda, and ?lang=lg printed the English one.
test('the brochure prints its own words in the language asked for', async () => {
  const english = await readPdf(await brochureBuffer(vanta, { language: 'en' }));
  const luganda = await readPdf(await brochureBuffer(vanta, { language: 'lg' }));
  const swahili = await readPdf(await brochureBuffer(vanta, { language: 'sw' }));
  for (const heading of [/The development/, /Homes and prices/, /How the price is paid/, /How to enquire/, /Artist’s impression/]) {
    assert.match(english.text, heading);
    assert.doesNotMatch(luganda.text, heading);
    assert.doesNotMatch(swahili.text, heading);
  }
  assert.match(luganda.text, /Ebikwata ku pulojekiti/);
  assert.match(luganda.text, /Amaka n’emiwendo/);
  assert.match(luganda.text, /Engeri y’okubuuza/);
  assert.match(luganda.text, /31 Okitobba 2027/);
  assert.match(swahili.text, /Nyumba na bei/);
  assert.match(swahili.text, /Jinsi ya kuuliza/);
  // The project's own Luganda: translations.lg and the per-item `labels.lg`.
  assert.match(luganda.text, /Vanta House ye pulojekiti ya apartimenti 100/);
  assert.match(luganda.text, /Ssente z’okuwandiisa/);
  // The font has no ŋ, so it prints the way Luganda is typed without it.
  assert.doesNotMatch(luganda.text, /ŋ/);
  assert.match(luganda.text, /ekung’aanyizibwa/);
  // Unknown languages, and languages without a pack, stay in English.
  const fallback = await readPdf(await brochureBuffer(vanta, { language: 'xx' }));
  assert.match(fallback.text, /Homes and prices/);
});

test('the site page shows the newest diary entry’s own photos, spread across it', () => {
  const urls = Array.from({ length: 14 }, (_, index) => `/assets/off-plan/vanta-house/construction-2026-11-13-site-${String(index + 1).padStart(2, '0')}.jpg`);
  const project = {
    ...vanta,
    extra_fields: {
      ...vanta.extra_fields,
      construction_updates: [
        { date: '2026-11-13', title: 'Structure at the 8th floor', titles: { lg: 'Ensengeka ku mwaliiro ogw’omunaana' }, image_urls: urls },
        ...(vanta.extra_fields.construction_updates || [])
      ]
    }
  };
  const english = prepareModel(project, { language: 'en' });
  assert.deepEqual(english.construction.map((image) => image.url.slice(-6, -4)), ['01', '03', '04', '06', '08', '09', '11', '12', '14']);
  assert.equal(english.sitePhotos, 'Site photos, 13 November 2026');
  assert.equal(english.update.title, 'Structure at the 8th floor');
  const luganda = prepareModel(project, { language: 'lg' });
  assert.equal(luganda.sitePhotos, 'Ebifaananyi by’oku kifo, 13 Novemba 2026');
  assert.equal(luganda.update.title, 'Ensengeka ku mwaliiro ogw’omunaana');
  // No diary photos on makaug.com: the project's construction photos, captioned.
  const remote = prepareModel({ ...project, extra_fields: { ...project.extra_fields, construction_updates: [{ date: '2026-11-13', title: 'Update', image_urls: ['https://example.com/a.jpg'] }] } }, { language: 'en' });
  assert.equal(remote.sitePhotos, '');
  assert.ok(remote.construction.length > 0);
  assert.ok(remote.construction.every((image) => image.kind === 'construction_photo' && image.caption));
});
