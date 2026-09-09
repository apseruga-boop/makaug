'use strict';

const { createHash } = require('crypto');
const { PDFParse } = require('pdf-parse');
const { getProviderClient, getTaskModel, toProviderFile } = require('./llmProvider');

const MAX_BROCHURE_BYTES = 70 * 1024 * 1024;
const MAX_AI_BROCHURE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 200_000;

function cleanText(value, max = 4000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function safeArray(value, max = 100) {
  return Array.isArray(value) ? value.slice(0, max).filter((item) => item && typeof item === 'object') : [];
}

function jsonFromText(value) {
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('The brochure extractor did not return a JSON object');
  return JSON.parse(raw.slice(first, last + 1));
}

function normalizeExtractedBrochure(raw = {}, context = {}) {
  const countryCode = cleanText(context.countryCode || 'UG', 2).toUpperCase();
  const countryName = cleanText(context.countryName || countryCode, 120);
  const name = cleanText(raw.name || context.fallbackName || 'Brochure project', 220);
  return {
    country_code: countryCode,
    name,
    developer_name: cleanText(raw.developer_name, 220) || null,
    source_display_name: cleanText(context.sourceDisplayName || raw.source_display_name || 'Developer brochure', 220),
    status: 'pending_review',
    verification_status: 'needs_verification',
    description: cleanText(raw.description, 20000),
    area: cleanText(raw.area, 140) || null,
    district: cleanText(raw.district, 140) || null,
    address: cleanText(raw.address, 800) || null,
    project_type: cleanText(raw.project_type || 'development', 80),
    completion_date: /^\d{4}-\d{2}-\d{2}$/.test(cleanText(raw.completion_date, 10)) ? cleanText(raw.completion_date, 10) : null,
    original_currency: cleanText(raw.original_currency || (countryCode === 'AE' ? 'AED' : 'USD'), 3).toUpperCase(),
    payment_plan_months: Number.isInteger(Number(raw.payment_plan_months)) && Number(raw.payment_plan_months) > 0 ? Number(raw.payment_plan_months) : null,
    unit_types: safeArray(raw.unit_types),
    payment_plan: safeArray(raw.payment_plan),
    amenities: safeArray(raw.amenities),
    nearby_places: safeArray(raw.nearby_places),
    extra_fields: {
      contact_mode: countryCode === 'UG' ? 'listing_request' : 'makaug_managed',
      country_name: countryName,
      country_slug: cleanText(context.countrySlug || countryName, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      region: cleanText(context.region || raw.region || (countryCode === 'UG' ? 'Africa' : 'Overseas'), 120),
      source_documents_verified: false,
      brochure_extraction: {
        extracted_at: new Date().toISOString(),
        facts_to_confirm: Array.isArray(raw.facts_to_confirm) ? raw.facts_to_confirm.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 50) : [],
        notes: cleanText(raw.extraction_notes, 2000) || null
      }
    }
  };
}

async function localBrochureText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return cleanText(result?.text, MAX_EXTRACTED_TEXT_CHARS);
  } finally {
    await parser.destroy();
  }
}

function extractionInstruction() {
  return 'Extract only facts explicitly present in this property-development brochure. Return one JSON object with keys: name, developer_name, description, area, district, address, project_type, completion_date (YYYY-MM-DD or null), original_currency, payment_plan_months, unit_types (array), payment_plan (array), amenities (array of objects with name), nearby_places (array of objects with name and supplied travel time/distance), region, facts_to_confirm (array), extraction_notes. Do not infer missing prices, dates, approvals, availability, yields, or guarantees. Put promotional or investment claims in facts_to_confirm.';
}

async function extractBrochureDraft(buffer, context = {}, dependencies = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.subarray(0, 4).toString() !== '%PDF') {
    const error = new Error('A valid PDF brochure is required');
    error.status = 400;
    throw error;
  }
  if (buffer.length > MAX_BROCHURE_BYTES) {
    const error = new Error('Brochure PDFs must be 70MB or smaller');
    error.status = 400;
    throw error;
  }
  const client = dependencies.client === undefined ? getProviderClient('off_plan') : dependencies.client;
  const fallbackName = cleanText(context.fallbackName || context.filename || 'Brochure project', 220).replace(/\.pdf$/i, '');
  if (!client) {
    return {
      payload: normalizeExtractedBrochure({}, { ...context, fallbackName }),
      extraction_status: 'provider_unavailable',
      extraction_warning: 'The brochure was stored, but automated extraction is unavailable. Complete the private review record manually.'
    };
  }

  let uploaded;
  try {
    const maxAiBrochureBytes = dependencies.maxAiBrochureBytes || MAX_AI_BROCHURE_BYTES;
    if (buffer.length > maxAiBrochureBytes) {
      const brochureText = await (dependencies.localBrochureText || localBrochureText)(buffer);
      if (!brochureText) throw new Error('No readable text was found in the large brochure');
      const response = await client.responses.create({
        model: dependencies.model || getTaskModel('brochure', process.env.OPENAI_OFF_PLAN_BROCHURE_MODEL || 'gpt-4.1-mini', 'off_plan'),
        input: [{ role: 'user', content: [{ type: 'input_text', text: `${extractionInstruction()}\n\nBROCHURE TEXT:\n${brochureText}` }] }],
        temperature: 0
      });
      const extracted = jsonFromText(response.output_text || '');
      return { payload: normalizeExtractedBrochure(extracted, { ...context, fallbackName }), extraction_status: 'completed_from_text', extraction_warning: 'The PDF exceeded the direct document-input limit, so its embedded text was extracted locally. Staff must verify facts against the original brochure.' };
    }
    const file = await (dependencies.toProviderFile || toProviderFile)(buffer, cleanText(context.filename || 'brochure.pdf', 180), { type: 'application/pdf' });
    uploaded = await client.files.create({ file, purpose: 'user_data' });
    const response = await client.responses.create({
      model: dependencies.model || getTaskModel('brochure', process.env.OPENAI_OFF_PLAN_BROCHURE_MODEL || 'gpt-4.1-mini', 'off_plan'),
      input: [{
        role: 'user',
        content: [
          { type: 'input_file', file_id: uploaded.id },
          { type: 'input_text', text: extractionInstruction() }
        ]
      }],
      temperature: 0
    });
    const extracted = jsonFromText(response.output_text || '');
    return { payload: normalizeExtractedBrochure(extracted, { ...context, fallbackName }), extraction_status: 'completed', extraction_warning: null };
  } catch (error) {
    return {
      payload: normalizeExtractedBrochure({}, { ...context, fallbackName }),
      extraction_status: 'extraction_failed',
      extraction_warning: `The brochure was stored, but automated extraction failed. Complete the private review record manually. (${cleanText(error?.message || 'provider error', 180)})`
    };
  } finally {
    if (uploaded?.id && client?.files?.delete) await client.files.delete(uploaded.id).catch(() => {});
  }
}

function brochureFingerprint(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  MAX_AI_BROCHURE_BYTES,
  MAX_BROCHURE_BYTES,
  brochureFingerprint,
  extractBrochureDraft,
  localBrochureText,
  jsonFromText,
  normalizeExtractedBrochure
};
