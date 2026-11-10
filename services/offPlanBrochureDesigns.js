'use strict';

// Three brochure layouts for the same off-plan project. They are samples for
// review: the public download stays on the existing generator. Every figure,
// caption and photograph comes from the project record.

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { normalizeDevelopmentRow } = require('./offPlanService');
const { distanceKmBetween, formatDate, localAssetPath, projectUrl } = require('./offPlanBrochureService');
const { OSM_ATTRIBUTION, osmStaticMapBuffer } = require('./osmStaticMap');

const REG = require('path').join(__dirname, '..', 'assets', 'fonts', 'share-card', 'PlusJakartaSans-Regular.ttf');
const SEMI = require('path').join(__dirname, '..', 'assets', 'fonts', 'share-card', 'PlusJakartaSans-SemiBold.ttf');
const BOLD = require('path').join(__dirname, '..', 'assets', 'fonts', 'share-card', 'PlusJakartaSans-Bold.ttf');

const GREEN = '#117a3d';
const GREEN_DARK = '#0c3b22';
const GOLD = '#b8860b';
const INK = '#1c2430';
const MUTED = '#5c6a74';
const PAPER = '#f6f4ef';
const WHITE = '#ffffff';
const PALE = '#eef3ee';
const W = 595.28;
const H = 841.89;
const MAP_W = 1200;
const MAP_H = 680;

const BROCHURE_DESIGNS = Object.freeze([
  { id: 'editorial', label: 'clean editorial', cover: 1, inner: [3, 5] },
  { id: 'magazine', label: 'image-led magazine', cover: 1, inner: [4, 6] },
  { id: 'sheet', label: 'compact sales sheet', cover: 1, inner: [2, 3] }
]);

function clean(value, max = 2000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function money(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  return `${currency} ${Math.round(value).toLocaleString('en-UG')}`;
}

function phone(value) {
  const digits = clean(value, 40).replace(/[^\d+]/g, '');
  const match = digits.match(/^\+?(256)(\d{3})(\d{3})(\d{3})$/);
  return match ? `+${match[1]} ${match[2]} ${match[3]} ${match[4]}` : clean(value, 40);
}

function waLink(value) {
  const digits = clean(value, 40).replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

function lede(description) {
  const sentences = clean(description, 4000).split(/(?<=\.)\s+/).filter(Boolean);
  let text = '';
  for (const sentence of sentences) {
    const next = text ? `${text} ${sentence}` : sentence;
    if (next.length > 360) break;
    text = next;
  }
  return text || clean(description, 360);
}

function categoryName(category) {
  const key = clean(category, 40).toLowerCase();
  if (key === 'school') return 'School';
  if (key === 'hospital') return 'Hospital';
  if (key === 'university') return 'University';
  if (key === 'shopping_mall' || key === 'supermarket') return 'Shopping';
  if (key === 'market') return 'Market';
  if (key === 'airport') return 'Airstrip';
  return clean(category, 40) || 'Nearby';
}

function kmLabel(km) {
  if (!Number.isFinite(km)) return 'distance to confirm';
  if (km < 0.1) return 'under 0.1 km';
  return `${km < 10 ? km.toFixed(1) : String(Math.round(km))} km`;
}

function pickPlaces(project, limit) {
  const scored = (project.nearby_places || []).map((place) => {
    const point = {
      latitude: Number(place.latitude ?? place.lat),
      longitude: Number(place.longitude ?? place.lng)
    };
    return { ...place, km: distanceKmBetween(project, point) };
  }).filter((place) => clean(place.name, 160)).sort((a, b) => (a.km ?? 99) - (b.km ?? 99));
  const picked = [];
  const seen = new Set();
  for (const group of ['school', 'hospital', 'university', 'shopping_mall', 'supermarket', 'market', 'airport']) {
    const hit = scored.find((place) => place.category === group && !seen.has(place.name));
    if (!hit) continue;
    picked.push(hit);
    seen.add(hit.name);
  }
  for (const place of scored) {
    if (picked.length >= limit) break;
    if (seen.has(place.name)) continue;
    picked.push(place);
    seen.add(place.name);
  }
  return picked.slice(0, limit);
}

function referencedAssets(value, found = []) {
  if (typeof value === 'string' && /^\/assets\/.+\.(?:jpe?g|png)$/i.test(value)) found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => referencedAssets(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => referencedAssets(item, found));
  return found;
}

function prepareModel(projectInput) {
  const project = normalizeDevelopmentRow(projectInput);
  const extra = project.extra_fields || {};
  const images = (project.images || []).map((image) => ({ ...image, path: localAssetPath(image.url) })).filter((image) => image.path);
  const byUrl = (needle) => images.find((image) => String(image.url).includes(needle)) || null;
  const plans = (project.floor_plans || []).map((plan) => ({ ...plan, path: localAssetPath(plan.url) })).filter((plan) => plan.path);
  const portraitUrl = referencedAssets(project).find((url) => url.includes('/assets/agents/'));
  const contact = extra.developer_contact || {};
  const units = (project.unit_types || []).map((unit) => ({
    key: unit.key,
    label: clean(unit.label, 80) || `${unit.bedrooms || ''} bedroom`,
    bedrooms: unit.bedrooms,
    bathrooms: unit.bathrooms,
    size: unit.size_sqm,
    usd: money(unit.price_original, unit.price_original_currency || project.original_currency || 'USD'),
    ugx: money(unit.price_ugx, 'UGX'),
    fee: Number(unit.management_fee_usd_month) > 0 ? `${money(unit.management_fee_usd_month, 'USD')} a month` : '',
    balcony: clean(unit.balcony, 80),
    living: clean(unit.living, 80),
    plan: plans.find((plan) => plan.unit_key === unit.key) || null
  }));
  const fact = (label) => clean((extra.key_facts || []).find((item) => item.label === label)?.value, 500);
  return {
    project,
    name: clean(project.name, 120) || 'Off-plan project',
    areaLine: [project.area, project.district].filter(Boolean).join(', '),
    address: clean(project.address, 180),
    description: clean(project.description, 4000),
    lede: lede(project.description),
    areaOverview: clean(extra.area_overview, 1200),
    developer: clean(project.developer_name, 160),
    contact,
    phones: {
      founder: phone(contact.phone),
      sales: phone(contact.sales_phone),
      founderLink: waLink(contact.whatsapp || contact.phone),
      salesLink: waLink(contact.sales_phone)
    },
    units,
    payments: project.payment_plan || [],
    amenities: (project.amenities || []).map((item) => clean(typeof item === 'string' ? item : item.label, 80)).filter(Boolean),
    places: pickPlaces(project, 8),
    timeline: Array.isArray(extra.construction_timeline) ? extra.construction_timeline : [],
    charges: Array.isArray(extra.government_charges) ? extra.government_charges : [],
    keyFacts: Array.isArray(extra.key_facts) ? extra.key_facts : [],
    fact,
    investment: clean(extra.investment_note, 600),
    floorRule: clean(extra.floor_price_rule?.note, 400),
    progressBasis: clean(extra.progress_basis, 500),
    completion: formatDate(project.completion_date, 'en'),
    progress: project.construction_progress,
    months: project.payment_plan_months,
    homes: project.units_total,
    priceUsd: units[0]?.usd || '',
    priceUgx: money(project.launch_price_ugx, 'UGX'),
    fxDate: formatDate(extra.price_fx_as_of, 'en'),
    url: projectUrl(project),
    mapLink: Number.isFinite(Number(project.latitude))
      ? `https://www.openstreetmap.org/?mlat=${project.latitude}&mlon=${project.longitude}#map=17/${project.latitude}/${project.longitude}`
      : 'https://www.openstreetmap.org/',
    hero: byUrl('hero-tower-day') || images.find((image) => image.kind === 'artist_impression') || images[0] || null,
    sunset: byUrl('hero-tower-sunset'),
    courtyard: byUrl('courtyard-and-pool'),
    pool: byUrl('pool-deck-render'),
    roof: byUrl('rooftop-bar-render'),
    sketch: byUrl('location-map'),
    construction: images.filter((image) => image.kind === 'construction_photo'),
    impressions: images.filter((image) => image.kind === 'artist_impression'),
    plans,
    typicalPlan: plans.find((plan) => plan.unit_key === 'typical') || plans[0] || null,
    portrait: portraitUrl ? { path: localAssetPath(portraitUrl), caption: clean(contact.name, 80) } : null,
    update: (extra.construction_updates || [])[0] || null
  };
}

function openDoc(model, label) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: `${model.name} - makaug.com off-plan (${label})`,
      Author: 'makaug.com',
      Subject: `${model.name}, ${model.areaLine}`
    }
  });
  doc.page.margins = { top: 0, right: 0, bottom: 0, left: 0 };
  doc.registerFont('Reg', REG);
  doc.registerFont('Semi', SEMI);
  doc.registerFont('Bold', BOLD);
  return doc;
}

function nextPage(doc) {
  doc.addPage({ size: 'A4', margin: 0 });
  doc.page.margins = { top: 0, right: 0, bottom: 0, left: 0 };
}

function text(doc, value, x, y, width, size, font, color, extra = {}) {
  const body = clean(value, extra.max || 2000);
  if (!body) return y;
  doc.font(font).fontSize(size).fillColor(color);
  const options = {
    width,
    align: extra.align || 'left',
    lineGap: extra.lineGap || 0,
    characterSpacing: extra.tracking || 0,
    lineBreak: extra.lineBreak !== false,
    link: extra.link || undefined,
    underline: Boolean(extra.underline)
  };
  const natural = doc.heightOfString(body, options);
  const height = extra.height || natural + 1;
  doc.text(body, x, y, { ...options, height, ellipsis: Boolean(extra.height && natural > height + 1) });
  return y + Math.min(natural, height);
}

function paintCover(doc, image, x, y, w, h, valign = 'center') {
  doc.save();
  doc.rect(x, y, w, h).clip();
  if (image?.path) doc.image(image.path, x, y, { cover: [w, h], align: 'center', valign });
  else doc.rect(x, y, w, h).fill(PALE);
  doc.restore();
}

function paintFit(doc, image, x, y, w, h) {
  doc.save();
  doc.rect(x, y, w, h).fill(WHITE);
  doc.rect(x, y, w, h).clip();
  if (image?.path) doc.image(image.path, x, y, { fit: [w, h], align: 'center', valign: 'center' });
  doc.restore();
}

function paintMap(doc, map, x, y, w) {
  const boxH = Math.round(w * MAP_H / MAP_W);
  if (!map) {
    doc.rect(x, y, w, boxH).fill(PALE);
    text(doc, 'OpenStreetMap tiles were unavailable while this sample was generated.', x + 16, y + boxH / 2 - 8, w - 32, 9, 'Reg', MUTED, { align: 'center', height: 24 });
    return boxH;
  }
  doc.image(map, x, y, { width: w, height: boxH });
  return boxH;
}

function footerQuiet(doc, page, label) {
  text(doc, 'makaug.com', 36, H - 26, 120, 8, 'Bold', GREEN, { lineBreak: false, height: 12 });
  text(doc, label, 160, H - 26, 300, 8, 'Reg', MUTED, { align: 'center', lineBreak: false, height: 12 });
  text(doc, String(page), W - 64, H - 26, 28, 8, 'Reg', MUTED, { align: 'right', lineBreak: false, height: 12 });
}

function editorialHead(doc, model, section) {
  doc.rect(0, 0, W, H).fill(PAPER);
  text(doc, 'makaug.com', 36, 20, 140, 9, 'Bold', GREEN, { lineBreak: false, height: 12 });
  text(doc, `${model.name}  ·  ${section}`, 190, 21, 368, 8, 'Reg', MUTED, { align: 'right', lineBreak: false, height: 12 });
  doc.moveTo(36, 38).lineTo(W - 36, 38).lineWidth(0.7).strokeColor(GOLD).stroke();
}

function drawEditorial(doc, model, map, qr) {
  doc.rect(0, 0, W, H).fill(PAPER);
  paintCover(doc, model.hero, 300, 0, W - 300, H, 'center');
  text(doc, 'makaug.com', 32, 36, 240, 12, 'Bold', GREEN, { lineBreak: false, height: 16 });
  text(doc, 'OFF-PLAN PROJECT', 32, 58, 240, 8, 'Semi', GOLD, { tracking: 1.3, lineBreak: false, height: 12 });
  text(doc, model.name, 32, 84, 246, 32, 'Bold', INK, { height: 78 });
  text(doc, model.areaLine, 32, 176, 246, 12, 'Reg', MUTED, { lineBreak: false, height: 16 });
  text(doc, model.address, 32, 196, 246, 8.5, 'Reg', MUTED, { height: 28 });
  text(doc, model.lede, 32, 236, 246, 9.5, 'Reg', INK, { height: 128, lineGap: 2 });
  doc.roundedRect(32, 378, 244, 88, 8).fill(WHITE);
  text(doc, 'FROM', 46, 390, 210, 8, 'Semi', GOLD, { tracking: 1.1, lineBreak: false, height: 12 });
  text(doc, model.priceUsd || model.priceUgx, 46, 406, 216, 16, 'Bold', GREEN, { lineBreak: false, height: 20 });
  text(doc, model.priceUgx ? `${model.priceUgx} indicative` : '', 46, 430, 216, 8, 'Reg', MUTED, { height: 22 });
  const coverFacts = [
    [model.homes ? `${model.homes} homes` : 'Homes', '1, 2 and 3 bedroom apartments'],
    [model.completion, 'Expected handover'],
    [model.months ? `${model.months} months` : 'Payment plan', 'Balance after 30% on signing']
  ];
  coverFacts.forEach((fact, index) => {
    const y = 488 + index * 52;
    doc.rect(32, y, 3, 32).fill(GOLD);
    text(doc, fact[0], 44, y, 220, 11, 'Bold', INK, { lineBreak: false, height: 16 });
    text(doc, fact[1], 44, y + 16, 220, 8, 'Reg', MUTED, { lineBreak: false, height: 12 });
  });
  text(doc, 'Artist’s impression. Final finishes may differ.', 32, H - 36, 246, 8, 'Reg', MUTED, { height: 22 });

  nextPage(doc);
  editorialHead(doc, model, 'The development');
  footerQuiet(doc, 2, model.areaLine);
  text(doc, 'The development', 36, 52, 520, 20, 'Bold', INK, { lineBreak: false, height: 26 });
  text(doc, model.description, 36, 86, 523, 9.5, 'Reg', INK, { height: 150, lineGap: 2 });
  let y = 248;
  model.keyFacts.slice(0, 7).forEach((item) => {
    text(doc, item.label, 36, y, 523, 7.5, 'Semi', GREEN, { tracking: 0.5, lineBreak: false, height: 11 });
    y = text(doc, item.value, 36, y + 12, 523, 9, 'Reg', INK, { height: 34 }) + 8;
  });
  if (Number.isFinite(Number(model.progress)) && y < 690) {
    text(doc, 'Construction so far', 36, y + 6, 400, 12, 'Bold', INK, { lineBreak: false, height: 16 });
    text(doc, `${Math.round(Number(model.progress))}%`, 430, y + 6, 129, 12, 'Bold', GREEN, { align: 'right', lineBreak: false, height: 16 });
    doc.roundedRect(36, y + 30, 523, 8, 4).fill('#e3e8e2');
    const progressWidth = Math.max(8, 523 * Math.min(100, Number(model.progress)) / 100);
    doc.roundedRect(36, y + 30, progressWidth, 8, 4).fill(GREEN);
    text(doc, model.progressBasis, 36, y + 48, 523, 8.5, 'Reg', MUTED, { height: 48, lineGap: 1 });
  }

  nextPage(doc);
  editorialHead(doc, model, 'Homes');
  footerQuiet(doc, 3, 'Unit types and prices');
  text(doc, 'Homes and prices', 36, 52, 520, 20, 'Bold', INK, { lineBreak: false, height: 26 });
  text(doc, model.floorRule, 36, 82, 523, 8.5, 'Reg', MUTED, { height: 36, lineGap: 1 });
  model.units.slice(0, 3).forEach((unit, index) => {
    const top = 128 + index * 210;
    doc.roundedRect(36, top, 523, 198, 8).fill(WHITE);
    paintFit(doc, unit.plan, 48, top + 16, 168, 150);
    text(doc, unit.label, 232, top + 18, 300, 13, 'Bold', INK, { height: 36 });
    text(doc, unit.usd, 232, top + 58, 300, 14, 'Bold', GREEN, { lineBreak: false, height: 18 });
    text(doc, unit.ugx ? `${unit.ugx} indicative` : '', 232, top + 78, 300, 8.5, 'Reg', MUTED, { lineBreak: false, height: 12 });
    const meta = [
      unit.size ? `${unit.size} sq m` : '',
      unit.bedrooms ? `${unit.bedrooms} bedroom${unit.bedrooms === 1 ? '' : 's'}` : '',
      unit.bathrooms ? `${unit.bathrooms} bathroom${unit.bathrooms === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join('   ·   ');
    text(doc, meta, 232, top + 98, 300, 9, 'Semi', INK, { lineBreak: false, height: 14 });
    text(doc, [unit.living, unit.balcony].filter(Boolean).join(' · '), 232, top + 116, 300, 8.5, 'Reg', MUTED, { height: 24 });
    text(doc, unit.fee ? `Service charge ${unit.fee}` : '', 232, top + 146, 300, 8.5, 'Reg', INK, { lineBreak: false, height: 14 });
    text(doc, 'First-floor starting price', 232, top + 164, 300, 8, 'Reg', MUTED, { lineBreak: false, height: 12 });
  });

  nextPage(doc);
  editorialHead(doc, model, 'Payment');
  footerQuiet(doc, 4, 'Payment plan and timing');
  text(doc, 'How the price is paid', 36, 52, 520, 20, 'Bold', INK, { height: 26 });
  model.payments.slice(0, 3).forEach((item, index) => {
    const top = 92 + index * 62;
    doc.circle(50, top + 16, 11).fill(GREEN);
    text(doc, String(index + 1), 40, top + 10, 20, 9, 'Bold', WHITE, { align: 'center', lineBreak: false, height: 12 });
    text(doc, item.label, 72, top + 4, 470, 11, 'Bold', INK, { lineBreak: false, height: 16 });
    text(doc, item.due || item.percent && `${item.percent}%` || '', 72, top + 22, 470, 8.5, 'Reg', MUTED, { height: 24 });
  });
  text(doc, 'Timing', 36, 292, 520, 14, 'Bold', INK, { lineBreak: false, height: 18 });
  (model.timeline || []).slice(0, 4).forEach((step, index) => {
    const y = 318 + index * 28;
    doc.circle(46, y + 6, 4).fill(step.status === 'done' ? GREEN : GOLD);
    text(doc, `${formatDate(step.date, 'en')}  —  ${clean(step.label, 140)}`, 60, y, 490, 9, 'Reg', INK, { lineBreak: false, height: 14 });
  });
  let afterTimeline = 318 + Math.max(1, model.timeline.length) * 28 + 8;
  text(doc, model.progressBasis, 36, afterTimeline, 523, 8.5, 'Reg', MUTED, { height: 48, lineGap: 1 });
  afterTimeline += 58;
  if (model.investment) {
    doc.roundedRect(36, afterTimeline, 523, 78, 8).fill('#fff8ea');
    text(doc, 'Developer estimate, not a promise', 50, afterTimeline + 10, 490, 8, 'Semi', GOLD, { lineBreak: false, height: 12 });
    text(doc, model.investment, 50, afterTimeline + 26, 490, 8.5, 'Reg', INK, { height: 42, lineGap: 1 });
    afterTimeline += 92;
  }
  model.charges.slice(0, 2).forEach((charge) => {
    text(doc, charge.label, 36, afterTimeline, 523, 8, 'Semi', GREEN, { lineBreak: false, height: 12 });
    afterTimeline = text(doc, charge.value, 36, afterTimeline + 12, 523, 8.5, 'Reg', INK, { height: 28 }) + 8;
  });

  nextPage(doc);
  editorialHead(doc, model, 'Location');
  footerQuiet(doc, 5, OSM_ATTRIBUTION);
  text(doc, 'Naguru, and how to get there', 36, 50, 520, 18, 'Bold', INK, { height: 24 });
  text(doc, model.areaOverview, 36, 78, 523, 8.5, 'Reg', INK, { height: 62, lineGap: 1 });
  const mapH = paintMap(doc, map, 36, 148, 523);
  text(doc, `Map data ${OSM_ATTRIBUTION}. The pin is the project coordinate. Confirm the entrance before you rely on a route.`, 36, 152 + mapH, 523, 7.5, 'Reg', MUTED, { height: 22 });
  text(doc, 'Open this pin on OpenStreetMap', 36, 174 + mapH, 360, 9, 'Bold', GREEN, { lineBreak: false, height: 14, link: model.mapLink });
  let placeY = 196 + mapH;
  model.places.slice(0, 6).forEach((place, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 36 + col * 268;
    const top = placeY + row * 36;
    text(doc, place.name, x, top, 190, 8.5, 'Semi', INK, { lineBreak: false, height: 12 });
    text(doc, `${categoryName(place.category)}  ·  ${kmLabel(place.km)}`, x, top + 13, 250, 7.5, 'Reg', MUTED, { lineBreak: false, height: 11 });
  });

  nextPage(doc);
  editorialHead(doc, model, 'Gallery');
  footerQuiet(doc, 6, 'Project images');
  text(doc, 'The building', 36, 50, 400, 18, 'Bold', INK, { lineBreak: false, height: 22 });
  paintCover(doc, model.sunset || model.hero, 36, 80, 523, 230);
  text(doc, model.sunset?.caption || model.hero?.caption, 36, 314, 523, 7.5, 'Reg', MUTED, { height: 20 });
  [[model.courtyard, 36], [model.pool, 304]].forEach(([image, x]) => {
    paintCover(doc, image, x, 340, 255, 145);
    text(doc, image?.caption, x, 489, 255, 7.5, 'Reg', MUTED, { height: 22 });
  });
  paintCover(doc, model.roof, 36, 520, 523, 175);
  text(doc, model.roof?.caption, 36, 699, 523, 7.5, 'Reg', MUTED, { height: 20 });
  text(doc, 'Artist’s impressions supplied by the developer. The specification in the sale agreement governs.', 36, 724, 523, 8, 'Reg', MUTED, { height: 22 });

  nextPage(doc);
  editorialHead(doc, model, 'On site');
  footerQuiet(doc, 7, 'Construction, November 2026');
  text(doc, model.update?.title || 'Construction', 36, 50, 520, 18, 'Bold', INK, { height: 24 });
  text(doc, model.update?.note, 36, 78, 523, 8.5, 'Reg', INK, { height: 48, lineGap: 1 });
  model.construction.slice(0, 9).forEach((image, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 36 + col * 176;
    const y = 136 + row * 168;
    paintCover(doc, image, x, y, 168, 112);
    text(doc, image.caption, x, y + 116, 168, 7, 'Reg', MUTED, { height: 28 });
  });

  nextPage(doc);
  editorialHead(doc, model, 'Floor plans');
  footerQuiet(doc, 8, 'Plans supplied by the developer');
  text(doc, 'Where the homes sit', 36, 50, 520, 18, 'Bold', INK, { height: 24 });
  text(doc, model.typicalPlan?.caption, 36, 76, 523, 8, 'Reg', MUTED, { height: 22 });
  paintFit(doc, model.typicalPlan, 36, 102, 523, 360);
  model.units.slice(0, 3).forEach((unit, index) => {
    const x = 36 + index * 176;
    paintFit(doc, unit.plan, x, 478, 168, 150);
    text(doc, unit.label, x, 634, 168, 8, 'Semi', INK, { height: 24 });
  });
  text(doc, 'Plans are for guidance. Confirm dimensions, orientation and the plan attached to the sale agreement.', 36, 668, 523, 8, 'Reg', MUTED, { height: 24 });

  nextPage(doc);
  editorialHead(doc, model, 'Enquire');
  footerQuiet(doc, 9, 'How to enquire');
  text(doc, 'Talk to the project', 36, 52, 360, 20, 'Bold', INK, { height: 26 });
  if (model.portrait?.path) paintCover(doc, model.portrait, 36, 92, 132, 156, 'top');
  else doc.roundedRect(36, 92, 132, 156, 6).fill(PALE);
  const who = clean(model.contact.name, 80);
  const role = clean(model.contact.role, 80);
  text(doc, who, 184, 96, 360, 16, 'Bold', INK, { lineBreak: false, height: 20 });
  text(doc, `${role}${model.developer ? ` · ${model.developer}` : ''}`, 184, 120, 370, 9, 'Reg', MUTED, { height: 28 });
  text(doc, model.phones.founder ? `WhatsApp  ${model.phones.founder}` : '', 184, 156, 360, 11, 'Bold', GREEN, { lineBreak: false, height: 16, link: model.phones.founderLink || undefined });
  text(doc, model.phones.sales ? `Sales desk  ${model.phones.sales}` : '', 184, 176, 360, 10, 'Semi', INK, { lineBreak: false, height: 14, link: model.phones.salesLink || undefined });
  text(doc, clean(model.contact.email, 80), 184, 196, 360, 9, 'Reg', INK, { lineBreak: false, height: 14, link: model.contact.email ? `mailto:${model.contact.email}` : undefined });
  text(doc, clean(model.contact.website, 120), 184, 214, 360, 9, 'Reg', GREEN, { lineBreak: false, height: 14, link: model.contact.website || undefined });
  text(doc, model.fact('Site visits'), 36, 268, 523, 9, 'Reg', INK, { height: 28 });
  if (qr) doc.image(qr, 470, 96, { width: 86, height: 86 });
  text(doc, 'Project page', 456, 186, 110, 8, 'Reg', MUTED, { align: 'center', lineBreak: false, height: 12 });
  const steps = [
    'Open the live project on makaug.com and choose a home type.',
    'WhatsApp the developer to book a free visit to the Naguru site.',
    'Ask for the unit, floor, view and the price in writing. The first-floor price rises 1% on each floor above.',
    'Read the sale agreement, the purchase guide and the title position with your own lawyer before you pay.',
    `Budget separately for ${model.charges.map((charge) => clean(charge.label, 40).toLowerCase()).filter(Boolean).join(' and ') || 'government charges'}.`
  ];
  text(doc, 'How to enquire', 36, 312, 520, 14, 'Bold', INK, { lineBreak: false, height: 18 });
  steps.forEach((step, index) => {
    const top = 340 + index * 36;
    text(doc, `${index + 1}`, 36, top, 18, 11, 'Bold', GREEN, { lineBreak: false, height: 14 });
    text(doc, step, 58, top, 500, 9, 'Reg', INK, { height: 30 });
  });
  text(doc, 'Walk-through films of each home, the November site film and the purchase guide are on the project page.', 36, 530, 523, 9, 'Reg', INK, { height: 28 });
  text(doc, 'Prices, availability, progress and handover dates can change. makaug.com publishes the developer’s figures and labels what is still to be confirmed. This brochure is not an offer.', 36, 574, 523, 8.5, 'Reg', MUTED, { height: 40, lineGap: 1 });
}

function magazineCaption(doc, image, x, y, w) {
  doc.rect(x, y, w, 28).fill(GREEN_DARK);
  text(doc, image?.caption || '', x + 10, y + 8, w - 20, 8, 'Reg', WHITE, { height: 14 });
}

function drawMagazine(doc, model, map, qr) {
  paintCover(doc, model.sunset || model.hero, 0, 0, W, 640, 'center');
  doc.rect(0, 640, W, H - 640).fill(GREEN_DARK);
  text(doc, 'makaug.com', 32, 658, 200, 11, 'Bold', WHITE, { lineBreak: false, height: 14 });
  text(doc, 'OFF-PLAN  ·  KAMPALA', 300, 660, 260, 8, 'Semi', '#e9a321', { align: 'right', tracking: 1, lineBreak: false, height: 12 });
  text(doc, model.name, 32, 686, 530, 32, 'Bold', WHITE, { height: 40 });
  text(doc, `${model.areaLine}   ·   ${model.address}`, 32, 732, 400, 9, 'Reg', '#d5e6da', { height: 24 });
  text(doc, model.priceUsd ? `From ${model.priceUsd}` : model.priceUgx, 32, 768, 360, 14, 'Bold', '#e9a321', { lineBreak: false, height: 18 });

  nextPage(doc);
  paintCover(doc, model.hero, 0, 0, W, 500, 'center');
  doc.rect(0, 500, W, H - 500).fill(PAPER);
  text(doc, model.hero?.caption, 32, 512, 530, 8, 'Reg', MUTED, { height: 20 });
  const stats = [
    [model.homes ? String(model.homes) : '—', 'apartments'],
    ['52–160', 'square metres'],
    [model.completion.replace(/\s+\d{4}$/, '') || model.completion, model.completion.match(/\d{4}$/)?.[0] || 'handover']
  ];
  stats.forEach((stat, index) => {
    const x = 32 + index * 186;
    text(doc, stat[0], x, 560, 170, 22, 'Bold', GREEN, { height: 28 });
    text(doc, stat[1], x, 592, 170, 9, 'Reg', MUTED, { lineBreak: false, height: 14 });
  });
  text(doc, model.lede, 32, 640, 530, 12, 'Reg', INK, { height: 110, lineGap: 3 });
  text(doc, 'makaug.com', 32, H - 36, 200, 9, 'Bold', GREEN, { lineBreak: false, height: 12 });

  nextPage(doc);
  doc.rect(0, 0, W, H).fill(PAPER);
  text(doc, 'makaug.com', 32, 28, 160, 9, 'Bold', GREEN, { lineBreak: false, height: 12 });
  text(doc, 'Three ways to live here', 32, 52, 520, 22, 'Bold', INK, { lineBreak: false, height: 28 });
  model.units.slice(0, 3).forEach((unit, index) => {
    const x = 28 + index * 188;
    paintFit(doc, unit.plan, x, 96, 176, 156);
    text(doc, unit.usd, x, 264, 176, 13, 'Bold', GREEN, { lineBreak: false, height: 18 });
    text(doc, unit.label, x, 286, 176, 9, 'Semi', INK, { height: 28 });
    text(doc, unit.ugx ? `${unit.ugx} indicative` : '', x, 318, 176, 7.5, 'Reg', MUTED, { height: 20 });
    text(doc, unit.fee ? `Service ${unit.fee}` : '', x, 338, 176, 7.5, 'Reg', INK, { height: 20 });
  });
  text(doc, model.floorRule, 32, 372, 530, 9, 'Reg', MUTED, { height: 48, lineGap: 1 });
  const amenityLine = model.amenities.slice(0, 8).join('   ·   ');
  text(doc, 'In the building', 32, 436, 530, 12, 'Bold', INK, { lineBreak: false, height: 16 });
  text(doc, amenityLine, 32, 460, 530, 11, 'Reg', INK, { height: 70, lineGap: 3 });
  text(doc, model.amenities.slice(8).join('   ·   '), 32, 536, 530, 10, 'Reg', INK, { height: 40 });
  text(doc, 'makaug.com', 32, H - 36, 200, 9, 'Bold', GREEN, { lineBreak: false, height: 12 });

  nextPage(doc);
  paintCover(doc, model.pool || model.courtyard, 0, 0, W, 400, 'center');
  magazineCaption(doc, model.pool || model.courtyard, 0, 372, W);
  paintCover(doc, model.roof || model.sunset, 0, 400, W, 442, 'center');
  magazineCaption(doc, model.roof || model.sunset, 0, H - 28, W);

  nextPage(doc);
  paintCover(doc, model.construction[7] || model.construction[0], 0, 0, W, 430, 'center');
  doc.rect(0, 430, W, H - 430).fill(WHITE);
  text(doc, 'On site', 32, 448, 200, 8, 'Semi', GOLD, { tracking: 1.1, lineBreak: false, height: 12 });
  text(doc, model.update?.title || 'Construction', 32, 466, 530, 18, 'Bold', INK, { height: 24 });
  text(doc, model.update?.note, 32, 498, 530, 9.5, 'Reg', INK, { height: 56, lineGap: 1 });
  model.construction.slice(0, 3).forEach((image, index) => {
    const x = 32 + index * 184;
    paintCover(doc, image, x, 570, 172, 120);
    text(doc, image.caption, x, 696, 172, 7.5, 'Reg', MUTED, { height: 28 });
  });
  text(doc, 'makaug.com', 32, H - 32, 160, 9, 'Bold', GREEN, { lineBreak: false, height: 12 });

  nextPage(doc);
  doc.rect(0, 0, W, 58).fill(GREEN_DARK);
  text(doc, 'makaug.com', 28, 14, 160, 10, 'Bold', WHITE, { lineBreak: false, height: 14 });
  text(doc, model.areaLine, 200, 16, 360, 10, 'Reg', '#d7efe0', { align: 'right', lineBreak: false, height: 14 });
  const mapH = paintMap(doc, map, 0, 58, W);
  text(doc, `Map data ${OSM_ATTRIBUTION}`, 28, 64 + mapH, 360, 8, 'Reg', MUTED, { lineBreak: false, height: 12 });
  text(doc, 'Open the pin', 400, 64 + mapH, 168, 8, 'Bold', GREEN, { align: 'right', lineBreak: false, height: 12, link: model.mapLink });
  text(doc, model.areaOverview, 28, 84 + mapH, 540, 8.5, 'Reg', INK, { height: 48, lineGap: 1 });
  model.places.slice(0, 6).forEach((place, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 28 + col * 280;
    const y = 142 + mapH + row * 32;
    text(doc, place.name, x, y, 190, 9, 'Semi', INK, { lineBreak: false, height: 12 });
    text(doc, `${categoryName(place.category)} · ${kmLabel(place.km)}`, x, y + 13, 250, 8, 'Reg', MUTED, { lineBreak: false, height: 12 });
  });
  const stripY = 142 + mapH + 3 * 32 + 14;
  [model.courtyard, model.pool, model.construction[0]].filter(Boolean).forEach((image, index) => {
    paintCover(doc, image, 28 + index * 188, stripY, 176, 108);
  });

  nextPage(doc);
  doc.rect(0, 0, W, H).fill(PAPER);
  text(doc, 'makaug.com', 32, 28, 160, 9, 'Bold', GREEN, { lineBreak: false, height: 12 });
  text(doc, 'Paying for it', 32, 56, 520, 22, 'Bold', INK, { lineBreak: false, height: 28 });
  model.payments.slice(0, 3).forEach((item, index) => {
    const y = 104 + index * 70;
    text(doc, String(index + 1).padStart(2, '0'), 32, y, 50, 16, 'Bold', GOLD, { lineBreak: false, height: 20 });
    text(doc, item.label, 90, y, 460, 13, 'Bold', INK, { lineBreak: false, height: 18 });
    text(doc, item.due, 90, y + 20, 460, 9, 'Reg', MUTED, { height: 28 });
  });
  text(doc, 'From structure to keys', 32, 330, 520, 14, 'Bold', INK, { lineBreak: false, height: 18 });
  model.timeline.slice(0, 3).forEach((step, index) => {
    const x = 32 + index * 184;
    doc.rect(x, 360, 28, 3).fill(step.status === 'done' ? GREEN : GOLD);
    text(doc, formatDate(step.date, 'en'), x, 372, 170, 8, 'Semi', GREEN, { lineBreak: false, height: 12 });
    text(doc, step.label, x, 388, 170, 9, 'Reg', INK, { height: 36 });
  });
  text(doc, model.investment, 32, 450, 530, 9, 'Reg', INK, { height: 56, lineGap: 1 });
  text(doc, model.fact('Ownership'), 32, 520, 530, 9, 'Reg', MUTED, { height: 40 });
  model.charges.forEach((charge, index) => {
    const y = 575 + index * 36;
    text(doc, charge.label, 32, y, 530, 8, 'Semi', GREEN, { lineBreak: false, height: 12 });
    text(doc, charge.value, 32, y + 12, 530, 8, 'Reg', INK, { height: 20 });
  });
  text(doc, 'makaug.com', 32, H - 32, 160, 9, 'Bold', GREEN, { lineBreak: false, height: 12 });

  nextPage(doc);
  doc.rect(0, 0, 250, H).fill(GREEN_DARK);
  if (model.portrait?.path) paintCover(doc, model.portrait, 40, 80, 170, 200, 'top');
  text(doc, 'makaug.com', 40, 40, 170, 11, 'Bold', WHITE, { lineBreak: false, height: 14 });
  text(doc, clean(model.contact.name, 60), 40, 310, 180, 16, 'Bold', WHITE, { height: 44 });
  text(doc, clean(model.contact.role, 60), 40, 360, 180, 9, 'Reg', '#d7efe0', { height: 28 });
  text(doc, model.developer, 40, 400, 180, 9, 'Reg', '#d7efe0', { height: 36 });
  text(doc, model.priceUsd ? `From ${model.priceUsd}` : model.priceUgx, 40, 720, 180, 13, 'Bold', '#e9a321', { height: 20 });
  text(doc, model.homes ? `${model.homes} homes · ${model.completion}` : model.completion, 40, 744, 180, 8, 'Reg', '#d7efe0', { height: 24 });
  text(doc, 'Enquire', 278, 48, 280, 22, 'Bold', INK, { lineBreak: false, height: 26 });
  text(doc, model.phones.founder, 278, 90, 280, 14, 'Bold', GREEN, { lineBreak: false, height: 18, link: model.phones.founderLink || undefined });
  text(doc, 'WhatsApp and phone', 278, 110, 280, 8, 'Reg', MUTED, { lineBreak: false, height: 12 });
  text(doc, model.phones.sales, 278, 136, 280, 12, 'Semi', INK, { lineBreak: false, height: 16, link: model.phones.salesLink || undefined });
  text(doc, 'Sales desk', 278, 154, 280, 8, 'Reg', MUTED, { lineBreak: false, height: 12 });
  text(doc, clean(model.contact.email, 80), 278, 180, 280, 10, 'Reg', INK, { lineBreak: false, height: 14, link: model.contact.email ? `mailto:${model.contact.email}` : undefined });
  text(doc, clean(model.contact.website, 80), 278, 198, 280, 10, 'Reg', GREEN, { lineBreak: false, height: 14, link: model.contact.website || undefined });
  if (qr) doc.image(qr, 278, 236, { width: 88, height: 88 });
  text(doc, model.url.replace('https://', ''), 374, 260, 180, 9, 'Reg', INK, { height: 36 });
  text(doc, model.fact('Site visits'), 278, 350, 280, 9, 'Reg', INK, { height: 48 });
  text(doc, 'Ask for the unit, the floor and the written price. Then have your own lawyer read the agreement and the title before any payment leaves your account.', 278, 410, 280, 10, 'Reg', INK, { height: 80, lineGap: 2 });
  text(doc, 'This is the developer’s information, published by makaug.com. It is not an offer, a mortgage quote or a promise of rent.', 278, 520, 280, 8.5, 'Reg', MUTED, { height: 50 });
}

function sheetHeader(doc, section) {
  doc.rect(0, 0, W, H).fill(WHITE);
  doc.rect(0, 0, W, 32).fill(GREEN);
  text(doc, 'makaug.com', 24, 9, 160, 11, 'Bold', WHITE, { lineBreak: false, height: 14 });
  text(doc, section, 200, 11, 370, 8, 'Reg', '#d7efe0', { align: 'right', lineBreak: false, height: 12 });
}

function drawSheet(doc, model, map, qr) {
  sheetHeader(doc, 'off-plan sales sheet');
  paintCover(doc, model.hero, 0, 32, W, 248, 'center');
  text(doc, model.name, 24, 296, 340, 22, 'Bold', INK, { height: 28 });
  text(doc, `${model.areaLine} · ${model.address}`, 24, 328, 360, 8, 'Reg', MUTED, { height: 22 });
  text(doc, model.priceUsd ? `From ${model.priceUsd}` : '', 400, 296, 172, 12, 'Bold', GREEN, { align: 'right', height: 28 });
  text(doc, model.priceUgx ? `${model.priceUgx} indicative` : '', 380, 328, 192, 8, 'Reg', MUTED, { align: 'right', height: 20 });
  model.units.slice(0, 3).forEach((unit, index) => {
    const x = 24 + index * 186;
    doc.roundedRect(x, 364, 176, 78, 6).fill(PALE);
    text(doc, unit.usd, x + 10, 374, 156, 12, 'Bold', GREEN, { lineBreak: false, height: 16 });
    text(doc, unit.label, x + 10, 394, 156, 8, 'Semi', INK, { height: 22 });
    text(doc, unit.fee ? `Service ${unit.fee}` : '', x + 10, 418, 156, 7.5, 'Reg', MUTED, { lineBreak: false, height: 12 });
  });
  const signing = model.payments.find((item) => Number(item.percent) > 0);
  const buildingLead = clean(model.fact('Building'), 80).split(':')[0];
  const chips = [
    model.homes ? `${model.homes} homes` : '',
    model.completion,
    model.months ? `${model.months}-month balance` : '',
    signing ? `${signing.percent}% on signing` : '',
    buildingLead.length <= 22 ? buildingLead : '',
    model.amenities.find((item) => /finished/i.test(item)) || ''
  ].filter(Boolean);
  chips.forEach((chip, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 24 + col * 186;
    const y = 458 + row * 28;
    doc.roundedRect(x, y, 176, 22, 4).fill('#f7f8f6');
    text(doc, chip, x + 8, y + 5, 160, 8, 'Semi', INK, { lineBreak: false, height: 12 });
  });
  text(doc, model.lede, 24, 530, 547, 9, 'Reg', INK, { height: 70, lineGap: 1 });
  text(doc, model.floorRule, 24, 610, 547, 8, 'Reg', MUTED, { height: 36 });
  const photoRow = [model.courtyard, model.pool, model.roof, model.construction[0]].filter(Boolean);
  photoRow.slice(0, 4).forEach((image, index) => paintCover(doc, image, 24 + index * 140, 660, 132, 88));
  text(doc, 'Artist’s impressions and a November 2026 site photo. Finishes may differ.', 24, 756, 420, 7.5, 'Reg', MUTED, { height: 18 });
  text(doc, '1', W - 40, 800, 16, 8, 'Reg', MUTED, { align: 'right', lineBreak: false, height: 12 });

  nextPage(doc);
  sheetHeader(doc, 'price, payment, timing');
  text(doc, 'Payment', 24, 48, 260, 13, 'Bold', INK, { lineBreak: false, height: 16 });
  model.payments.slice(0, 3).forEach((item, index) => {
    const y = 72 + index * 44;
    text(doc, item.label, 24, y, 270, 9, 'Semi', INK, { height: 22 });
    text(doc, item.due, 24, y + 20, 270, 7.5, 'Reg', MUTED, { height: 20 });
  });
  text(doc, 'Timeline', 320, 48, 250, 13, 'Bold', INK, { lineBreak: false, height: 16 });
  model.timeline.slice(0, 3).forEach((step, index) => {
    const y = 72 + index * 44;
    text(doc, formatDate(step.date, 'en'), 320, y, 250, 8, 'Semi', GREEN, { lineBreak: false, height: 12 });
    text(doc, step.label, 320, y + 14, 250, 8, 'Reg', INK, { height: 22 });
  });
  text(doc, model.progressBasis, 24, 214, 547, 8, 'Reg', MUTED, { height: 36 });
  text(doc, 'Amenities', 24, 258, 540, 13, 'Bold', INK, { lineBreak: false, height: 16 });
  model.amenities.slice(0, 12).forEach((amenity, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 24 + col * 280;
    const y = 282 + row * 22;
    doc.rect(x, y + 4, 6, 6).fill(GREEN);
    text(doc, amenity, x + 14, y, 250, 8.5, 'Reg', INK, { lineBreak: false, height: 12 });
  });
  text(doc, 'Buying costs, on top of the price', 24, 424, 540, 12, 'Bold', INK, { lineBreak: false, height: 16 });
  model.charges.forEach((charge, index) => {
    const y = 448 + index * 32;
    text(doc, charge.label, 24, y, 547, 8, 'Semi', GREEN, { lineBreak: false, height: 12 });
    text(doc, charge.value, 24, y + 12, 547, 8, 'Reg', INK, { height: 18 });
  });
  doc.roundedRect(24, 524, 547, 70, 6).fill('#fff8ea');
  text(doc, 'Developer estimate, not a forecast you can bank', 36, 534, 520, 8, 'Semi', GOLD, { lineBreak: false, height: 12 });
  text(doc, model.investment, 36, 550, 520, 8, 'Reg', INK, { height: 36 });
  text(doc, model.fact('Ownership'), 24, 608, 547, 8, 'Reg', MUTED, { height: 36 });
  text(doc, model.fact('Delivery standard'), 24, 650, 547, 8, 'Reg', INK, { height: 28 });
  text(doc, model.fact('Payment methods'), 24, 684, 547, 8, 'Reg', INK, { height: 24 });
  text(doc, '2', W - 40, 800, 16, 8, 'Reg', MUTED, { align: 'right', lineBreak: false, height: 12 });

  nextPage(doc);
  sheetHeader(doc, 'location');
  text(doc, model.areaLine, 24, 44, 400, 14, 'Bold', INK, { lineBreak: false, height: 18 });
  text(doc, model.address, 24, 64, 400, 8, 'Reg', MUTED, { lineBreak: false, height: 12 });
  const mapH = paintMap(doc, map, 24, 84, 547);
  text(doc, `Map data ${OSM_ATTRIBUTION}. Straight-line distances, not drive times.`, 24, 90 + mapH, 380, 7.5, 'Reg', MUTED, { height: 20 });
  text(doc, 'Open the pin', 430, 90 + mapH, 140, 8, 'Bold', GREEN, { align: 'right', lineBreak: false, height: 12, link: model.mapLink });
  model.places.slice(0, 8).forEach((place, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 24 + col * 280;
    const y = 118 + mapH + row * 28;
    text(doc, place.name, x, y, 180, 8, 'Semi', INK, { lineBreak: false, height: 12 });
    text(doc, `${categoryName(place.category)} · ${kmLabel(place.km)}`, x + 180, y, 90, 8, 'Reg', MUTED, { align: 'right', lineBreak: false, height: 12 });
  });
  const stripY = 118 + mapH + 4 * 28 + 8;
  [model.sketch, model.construction[7], model.courtyard, model.sunset].filter(Boolean).slice(0, 4).forEach((image, index) => {
    paintCover(doc, image, 24 + index * 140, stripY, 132, 84);
  });
  text(doc, 'Developer location sketch, site photo and impressions.', 24, stripY + 88, 500, 7.5, 'Reg', MUTED, { height: 16 });
  text(doc, '3', W - 40, 800, 16, 8, 'Reg', MUTED, { align: 'right', lineBreak: false, height: 12 });

  nextPage(doc);
  sheetHeader(doc, 'plans and enquiry');
  const planSet = [model.typicalPlan, ...model.units.slice(0, 3).map((unit) => unit.plan)].filter(Boolean).slice(0, 4);
  planSet.forEach((plan, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 24 + col * 280;
    const y = 44 + row * 188;
    paintFit(doc, plan, x, y, 270, 150);
    text(doc, plan.caption || plan.label, x, y + 154, 270, 7.5, 'Reg', MUTED, { height: 22 });
  });
  doc.rect(0, 430, W, H - 430).fill(PALE);
  if (model.portrait?.path) paintCover(doc, model.portrait, 24, 448, 72, 86, 'top');
  text(doc, clean(model.contact.name, 60) || model.developer, 108, 448, 280, 12, 'Bold', INK, { lineBreak: false, height: 16 });
  text(doc, `${clean(model.contact.role, 40)} · ${model.developer}`, 108, 466, 300, 8, 'Reg', MUTED, { height: 20 });
  text(doc, model.phones.founder ? `WhatsApp ${model.phones.founder}` : '', 108, 492, 280, 10, 'Bold', GREEN, { lineBreak: false, height: 14, link: model.phones.founderLink || undefined });
  text(doc, model.phones.sales ? `Sales ${model.phones.sales}` : '', 108, 508, 280, 9, 'Semi', INK, { lineBreak: false, height: 12, link: model.phones.salesLink || undefined });
  if (qr) doc.image(qr, 470, 446, { width: 78, height: 78 });
  text(doc, 'Free site visit. Ask for the unit, floor and written price, then have your own lawyer read the agreement before you pay.', 24, 548, 420, 8.5, 'Reg', INK, { height: 32 });
  text(doc, 'Prices, progress and handover can change. Published by makaug.com from the developer’s material. Not an offer.', 24, 592, 547, 8, 'Reg', MUTED, { height: 24 });
  text(doc, model.url.replace('https://', ''), 24, 624, 400, 8, 'Bold', GREEN, { lineBreak: false, height: 12, link: model.url });
  text(doc, '4', W - 40, 800, 16, 8, 'Reg', MUTED, { align: 'right', lineBreak: false, height: 12 });
}

const DRAW = {
  editorial: drawEditorial,
  magazine: drawMagazine,
  sheet: drawSheet
};

function pdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function brochureDesignBuffer(projectInput, design, options = {}) {
  const spec = BROCHURE_DESIGNS.find((item) => item.id === design);
  if (!spec) throw new Error(`Unknown brochure design: ${design}`);
  const model = prepareModel(projectInput);
  const map = options.mapBuffer !== undefined
    ? options.mapBuffer
    : await osmStaticMapBuffer(projectInput, { width: MAP_W, height: MAP_H, zoom: 16 });
  const qr = options.qrBuffer !== undefined
    ? options.qrBuffer
    : await QRCode.toBuffer(model.url, { type: 'png', margin: 0, width: 280, color: { dark: '#117a3d', light: '#ffffff' } });
  const doc = openDoc(model, spec.label);
  DRAW[design](doc, model, map, qr);
  return pdfBuffer(doc);
}

module.exports = {
  BROCHURE_DESIGNS,
  MAP_H,
  MAP_W,
  brochureDesignBuffer,
  prepareModel
};
