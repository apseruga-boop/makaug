'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractBrochureDraft,
  jsonFromText,
  normalizeExtractedBrochure
} = require('../services/offPlanBrochureIntakeService');

test('brochure extraction normalization always creates a private unverified review record', () => {
  const payload = normalizeExtractedBrochure({
    name: 'Beverly Park',
    developer_name: 'HMB',
    description: 'Developer-supplied description',
    area: 'Dubailand',
    original_currency: 'AED',
    amenities: [{ name: 'Rooftop pool' }],
    facts_to_confirm: ['Rental yield claim']
  }, { countryCode: 'AE', countryName: 'United Arab Emirates', countrySlug: 'united-arab-emirates', region: 'Middle East' });
  assert.equal(payload.status, 'pending_review');
  assert.equal(payload.verification_status, 'needs_verification');
  assert.equal(payload.country_code, 'AE');
  assert.equal(payload.extra_fields.source_documents_verified, false);
  assert.deepEqual(payload.extra_fields.brochure_extraction.facts_to_confirm, ['Rental yield claim']);
});

test('brochure extraction accepts fenced provider JSON but does not invent missing facts', () => {
  const parsed = jsonFromText('```json\n{"name":"Beverly Park","completion_date":null}\n```');
  const payload = normalizeExtractedBrochure(parsed, { countryCode: 'AE', countryName: 'United Arab Emirates' });
  assert.equal(payload.name, 'Beverly Park');
  assert.equal(payload.completion_date, null);
  assert.deepEqual(payload.unit_types, []);
});

test('an unavailable extraction provider still returns a review-safe brochure shell', async () => {
  const result = await extractBrochureDraft(Buffer.from('%PDF-1.4\nmock'), { countryCode: 'AE', countryName: 'United Arab Emirates', filename: 'Beverly Park.pdf' }, { client: null });
  assert.equal(result.extraction_status, 'provider_unavailable');
  assert.equal(result.payload.name, 'Beverly Park');
  assert.equal(result.payload.status, 'pending_review');
});

test('a provider failure still returns a review-safe shell and cleans up its uploaded file', async () => {
  let deletedId = null;
  const client = {
    files: {
      create: async () => ({ id: 'file-123' }),
      delete: async (id) => { deletedId = id; }
    },
    responses: { create: async () => { throw new Error('temporary provider failure'); } }
  };
  const result = await extractBrochureDraft(
    Buffer.from('%PDF-1.4\nmock'),
    { countryCode: 'AE', countryName: 'United Arab Emirates', filename: 'Beverly Park.pdf' },
    { client, toProviderFile: async () => ({}) }
  );
  assert.equal(result.extraction_status, 'extraction_failed');
  assert.equal(result.payload.status, 'pending_review');
  assert.equal(deletedId, 'file-123');
});

test('a readable brochure uses local text before attempting a provider file upload', async () => {
  const client = {
    files: { create: async () => { throw new Error('readable brochure must not be uploaded directly'); } },
    responses: { create: async ({ input }) => {
      assert.match(input[0].content[0].text, /BROCHURE TEXT:[\s\S]*Beverly Grande/);
      return { output_text: '{"name":"Beverly Grande","developer_name":"HMB Homes","area":"Motor City"}' };
    } }
  };
  const result = await extractBrochureDraft(
    Buffer.from('%PDF-1.4\nmock'),
    { countryCode: 'AE', countryName: 'United Arab Emirates', filename: 'Beverly Grande.pdf' },
    { client, localBrochureText: async () => 'Beverly Grande by HMB Homes in Motor City.' }
  );
  assert.equal(result.extraction_status, 'completed_from_text');
  assert.equal(result.payload.status, 'pending_review');
  assert.equal(result.payload.area, 'Motor City');
});

test('a brochure above the direct provider limit uses local text and stays review-only', async () => {
  const client = {
    files: { create: async () => { throw new Error('large brochure must not be uploaded directly'); } },
    responses: { create: async ({ input }) => {
      assert.match(input[0].content[0].text, /BROCHURE TEXT:[\s\S]*Beverly Park/);
      return { output_text: '{"name":"Beverly Park","developer_name":"HMB","facts_to_confirm":["8.5% rental yield claim"]}' };
    } }
  };
  const result = await extractBrochureDraft(
    Buffer.from('%PDF-1.4\nmock'),
    { countryCode: 'AE', countryName: 'United Arab Emirates', filename: 'Beverly Park.pdf' },
    { client, maxAiBrochureBytes: 1, localBrochureText: async () => 'Beverly Park by HMB. Rental yield claim: 8.5%.' }
  );
  assert.equal(result.extraction_status, 'completed_from_text');
  assert.equal(result.payload.status, 'pending_review');
  assert.deepEqual(result.payload.extra_fields.brochure_extraction.facts_to_confirm, ['8.5% rental yield claim']);
});
