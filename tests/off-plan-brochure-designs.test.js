'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { PDFParse } = require('pdf-parse');
const { BROCHURE_DESIGNS, brochureDesignBuffer, prepareModel } = require('../services/offPlanBrochureDesigns');

const project = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/off-plan/vanta-house.development.json'), 'utf8'));

async function textOf(pdf) {
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

test('Vanta House model uses only the project record', () => {
  const model = prepareModel(project);
  assert.equal(model.name, 'Vanta House');
  assert.equal(model.areaLine, 'Naguru, Kampala');
  assert.equal(model.units.length, 3);
  assert.match(model.priceUsd, /USD 53,800/);
  assert.ok(model.hero.path.endsWith('hero-tower-day.jpg'));
  assert.ok(model.construction.length >= 8);
  assert.ok(model.plans.length >= 4);
  assert.equal(model.portrait.caption, 'John Yan');
  assert.ok(model.places.some((place) => /Naguru Parents School/.test(place.name)));
  assert.match(model.url, /^https:\/\/makaug\.com\/off-plan\/vanta-house$/);
});

test('three brochure designs render distinct Vanta House PDFs with a map credit', async () => {
  const map = await sharp({ create: { width: 1200, height: 680, channels: 3, background: '#9db8a4' } }).png().toBuffer();
  const seen = new Set();
  for (const design of BROCHURE_DESIGNS) {
    const pdf = await brochureDesignBuffer(project, design.id, { mapBuffer: map });
    assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.3', design.id);
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert.equal(pages, design.id === 'sheet' ? 4 : design.id === 'magazine' ? 8 : 9, design.id);
    assert.ok(pdf.length > 80_000, design.id);
    const text = await textOf(pdf);
    assert.match(text, /makaug\.com/, design.id);
    assert.match(text, /Vanta House/, design.id);
    assert.match(text, /OpenStreetMap contributors/, design.id);
    assert.match(text, /53,800/, design.id);
    assert.match(text, /Blackstone/, design.id);
    assert.doesNotMatch(text, /static map was unavailable/i, design.id);
    assert.doesNotMatch(text, /MakaUG/, design.id);
    seen.add(pdf.length);
  }
  assert.equal(seen.size, 3);
});
