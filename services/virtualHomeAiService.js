'use strict';

const { getProviderClient, getProviderMeta, getTaskModel } = require('./llmProvider');

const SYSTEM_PROMPT = `You assist trained property staff in transcribing a floor plan into a review draft.
Never invent dimensions, scale, rooms, walls, doors, windows, labels, or developer claims.
Use only values visibly supported by the source. Unknown information must stay null or be omitted.
Coordinates must be in metres only when the plan provides enough dimensions to derive them. Otherwise return empty geometry and flag the missing items.
Return strict JSON only with keys property_model, confidence_items, review_summary.
property_model must follow makaug.property-model.v1 with units metres, scale {state:KNOWN|ESTIMATED|UNKNOWN,metres_per_source_unit,known_measurement,source}, and floors[].
Each floor can contain key,label,elevation_m,ceiling_height_m,rooms,walls,doors,windows,stairs.
Each confidence item needs element_key,element_type,label,value,confidence from 0 to 1,source and review_state UNREVIEWED.
This is a review draft, never an approved plan.`;

function parseJsonResponse(value) {
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch (_) { return null; }
}

async function interpretFloorPlan({ dataUrl, filename = 'floor-plan', notes = '' } = {}) {
  const client = getProviderClient('VIRTUAL_HOME');
  if (!client) {
    const error = new Error('AI plan interpretation is not configured. The source is saved safely for staff transcription.');
    error.status = 503;
    error.code = 'VIRTUAL_HOME_AI_UNAVAILABLE';
    throw error;
  }
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(String(dataUrl || ''))) {
    const error = new Error('AI interpretation currently accepts JPG, PNG, or WebP plans. Save PDFs and TIFFs for staff review.');
    error.status = 400;
    throw error;
  }
  const model = getTaskModel('PLAN', 'gpt-4o-mini', 'VIRTUAL_HOME');
  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: `File: ${String(filename).slice(0, 180)}\nStaff notes: ${String(notes || 'None').slice(0, 3000)}\nExtract only what is visibly supported and flag every uncertainty.` },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
      ] }
    ]
  });
  const parsed = parseJsonResponse(response.choices?.[0]?.message?.content);
  if (!parsed || typeof parsed !== 'object') {
    const error = new Error('AI interpretation returned no usable review draft. The source remains available for staff review.');
    error.status = 502;
    error.code = 'VIRTUAL_HOME_AI_INVALID_RESPONSE';
    throw error;
  }
  return {
    property_model: parsed.property_model && typeof parsed.property_model === 'object' ? parsed.property_model : { schema: 'makaug.property-model.v1', units: 'metres', scale: { state: 'UNKNOWN', metres_per_source_unit: null, source: 'ai' }, floors: [] },
    confidence_items: Array.isArray(parsed.confidence_items) ? parsed.confidence_items : [],
    review_summary: String(parsed.review_summary || 'AI review draft created. Staff verification is required.').slice(0, 4000),
    provider: getProviderMeta('VIRTUAL_HOME').provider,
    model
  };
}

module.exports = { interpretFloorPlan, parseJsonResponse };
