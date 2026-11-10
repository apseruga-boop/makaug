'use strict';

// Clean editorial brochure. This is the PDF the public off-plan route serves.
// Pages and lines appear only when the project record has something to say.

const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { normalizeDevelopmentRow } = require('./offPlanService');
const { distanceKmBetween, formatDate, localAssetPath, projectUrl } = require('./offPlanBrochureService');
const { OSM_ATTRIBUTION } = require('./osmStaticMap');

const REG = path.join(__dirname, '..', 'assets', 'fonts', 'share-card', 'PlusJakartaSans-Regular.ttf');
const SEMI = path.join(__dirname, '..', 'assets', 'fonts', 'share-card', 'PlusJakartaSans-SemiBold.ttf');
const BOLD = path.join(__dirname, '..', 'assets', 'fonts', 'share-card', 'PlusJakartaSans-Bold.ttf');

const GREEN = '#117a3d';
const GOLD = '#b8860b';
const INK = '#1c2430';
const MUTED = '#5c6a74';
const PAPER = '#f6f4ef';
const WHITE = '#ffffff';
const W = 595.28;
const H = 841.89;
const MAP_W = 1200;
const MAP_H = 680;

function clean(value, max = 2000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function missing(value) {
  const text = clean(value, 500);
  if (!text) return true;
  return text.length <= 120 && /to be confirmed|to verify|details to be confirmed|price on request|not (yet )?confirmed|\btbc\b|^n\/a$/i.test(text);
}

function money(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${currency} ${Math.round(value).toLocaleString('en-UG')}`;
}

function rangeMoney(amount, maximum, currency) {
  const start = money(amount, currency);
  const end = money(maximum, currency);
  if (!start) return '';
  return end && Number(maximum) > Number(amount) ? `${start} – ${end}` : start;
}

function phone(value) {
  const digits = clean(value, 40).replace(/[^\d+]/g, '');
  const match = digits.match(/^\+?(256)(\d{3})(\d{3})(\d{3})$/);
  return match ? `+${match[1]} ${match[2]} ${match[3]} ${match[4]}` : (missing(value) ? '' : clean(value, 40));
}

function waLink(value) {
  const digits = clean(value, 40).replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

function lede(description) {
  const source = clean(description, 4000);
  if (missing(source) || source.length < 40) return '';
  const sentences = source.split(/(?<=\.)\s+/).filter(Boolean);
  let text = '';
  for (const sentence of sentences) {
    const next = text ? `${text} ${sentence}` : sentence;
    if (next.length > 360) break;
    text = next;
  }
  return text || source.slice(0, 360);
}

function categoryName(category) {
  const key = clean(category, 40).toLowerCase();
  if (/school|child|nursery/.test(key)) return 'School';
  if (/hospital|clinic|health/.test(key)) return 'Hospital';
  if (/university|college/.test(key)) return 'University';
  if (/mall|shop|supermarket/.test(key)) return 'Shopping';
  if (/market/.test(key)) return 'Market';
  if (/airport|airstrip/.test(key)) return 'Airstrip';
  const label = clean(category, 40);
  return missing(label) ? '' : label;
}

function kmLabel(km) {
  if (!Number.isFinite(km)) return '';
  if (km < 0.1) return 'under 0.1 km';
  return `${km < 10 ? km.toFixed(1) : String(Math.round(km))} km`;
}

function sourceOf(image, buffers, index) {
  if (!image) return null;
  return localAssetPath(image.url) || buffers[index] || null;
}

function prepareModel(projectInput, options = {}) {
  const project = normalizeDevelopmentRow(projectInput);
  const extra = project.extra_fields && typeof project.extra_fields === 'object' ? project.extra_fields : {};
  const buffers = Array.isArray(options.imageBuffers) ? options.imageBuffers : [];
  const images = (project.images || []).map((image, index) => ({
    ...image,
    path: sourceOf(image, buffers, index)
  })).filter((image) => image.path);
  const hero = images.find((image) => image.kind === 'artist_impression') || images[0] || null;
  const plans = (project.floor_plans || []).map((plan) => ({ ...plan, path: localAssetPath(plan.url) })).filter((plan) => plan.path);
  const units = (project.unit_types || []).map((unit) => {
    const currency = clean(unit.price_original_currency || project.original_currency || 'USD', 3).toUpperCase();
    const originalPriceMax = Number(unit.price_original_max);
    const ugxPriceMax = Number(unit.price_ugx_max);
    const usd = currency === 'UGX' ? '' : rangeMoney(unit.price_original, originalPriceMax, currency);
    const ugx = rangeMoney(unit.price_ugx, ugxPriceMax, 'UGX');
    const sizeMin = Number(unit.size_sqm_min || unit.size_sqm);
    const sizeMax = Number(unit.size_sqm_max);
    return {
      label: missing(unit.label) ? '' : clean(unit.label, 80),
      bedrooms: Number(unit.bedrooms),
      bathrooms: Number(unit.bathrooms),
      size: sizeMin > 0 ? sizeMin : null,
      sizeLabel: sizeMin > 0 && sizeMax > sizeMin ? `${sizeMin}–${sizeMax} sq m` : sizeMin > 0 ? `${sizeMin} sq m` : '',
      usd: unit.price_original_currency === 'UGX' ? '' : usd,
      ugx,
      price: usd || ugx,
      fee: Number(unit.management_fee_usd_month) > 0 ? `${money(unit.management_fee_usd_month, 'USD')} a month` : '',
      balcony: missing(unit.balcony) ? '' : clean(unit.balcony, 80),
      living: missing(unit.living) ? '' : clean(unit.living, 80),
      plan: plans.find((plan) => plan.unit_key && plan.unit_key === unit.key) || null
    };
  }).filter((unit) => unit.price);
  const contact = extra.developer_contact && typeof extra.developer_contact === 'object' ? extra.developer_contact : {};
  const agent = options.agentProfile && typeof options.agentProfile === 'object' ? options.agentProfile : null;
  const agentPhoto = agent ? localAssetPath(agent.profile_photo_url) : null;
  const referenced = [];
  const walk = (value) => {
    if (typeof value === 'string' && /^\/assets\/.+\.(?:jpe?g|png)$/i.test(value)) referenced.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(project);
  const portraitUrl = referenced.find((url) => url.includes('/assets/agents/'));
  const places = (project.nearby_places || []).map((place) => {
    const point = { latitude: Number(place.latitude ?? place.lat), longitude: Number(place.longitude ?? place.lng) };
    return { name: clean(place.name, 120), category: categoryName(place.category), km: distanceKmBetween(project, point) };
  }).filter((place) => place.name && !missing(place.name)).sort((a, b) => (a.km ?? 99) - (b.km ?? 99));
  const area = missing(project.area) ? '' : clean(project.area, 80);
  const district = missing(project.district) ? '' : clean(project.district, 80);
  const beds = [...new Set(units.map((unit) => unit.bedrooms).filter((value) => Number.isFinite(value) && value > 0))];
  const signing = (project.payment_plan || []).find((item) => Number(item.percent) > 0);
  return {
    name: clean(project.name, 120) || 'Off-plan project',
    areaLine: [area, district].filter(Boolean).join(', '),
    address: missing(project.address) ? '' : clean(project.address, 180),
    description: missing(project.description) || clean(project.description, 4000).length < 40 ? '' : clean(project.description, 4000),
    lede: lede(project.description),
    areaOverview: missing(extra.area_overview) ? '' : clean(extra.area_overview, 1200),
    developer: missing(project.developer_name) ? '' : clean(project.developer_name, 160),
    contactName: missing(contact.name) ? (agent && !missing(agent.full_name) ? clean(agent.full_name, 80) : '') : clean(contact.name, 80),
    contactRole: missing(contact.role) ? '' : clean(contact.role, 80),
    contactEmail: missing(contact.email)
      ? (agent && !missing(agent.email) ? clean(agent.email, 80) : (extra.contact_mode === 'makaug_managed' ? 'info@makaug.com' : ''))
      : clean(contact.email, 80),
    contactWebsite: missing(contact.website) ? '' : clean(contact.website, 160),
    phones: {
      founder: phone(contact.phone || contact.whatsapp || agent?.whatsapp || agent?.phone),
      sales: phone(contact.sales_phone),
      founderLink: waLink(contact.whatsapp || contact.phone || agent?.whatsapp || agent?.phone),
      salesLink: waLink(contact.sales_phone)
    },
    bio: agent && !missing(agent.bio) ? clean(agent.bio, 280) : '',
    units,
    payments: (project.payment_plan || []).filter((item) => !missing(item.label) || Number(item.percent) > 0 || Number(item.amount_original) > 0).map((item) => ({
      label: missing(item.label) ? 'Payment' : clean(item.label, 120),
      due: missing(item.due) ? '' : clean(item.due, 220),
      percent: Number(item.percent)
    })),
    amenities: (project.amenities || []).map((item) => clean(typeof item === 'string' ? item : item.label, 80)).filter((item) => item && !missing(item)),
    places: places.slice(0, 8),
    timeline: (Array.isArray(extra.construction_timeline) ? extra.construction_timeline : []).filter((step) => !missing(step.label)),
    charges: (Array.isArray(extra.government_charges) ? extra.government_charges : []).filter((item) => !missing(item.label) && !missing(item.value)),
    keyFacts: (Array.isArray(extra.key_facts) ? extra.key_facts : []).filter((item) => !missing(item.label) && !missing(item.value)).slice(0, 7),
    investment: missing(extra.investment_note) ? '' : clean(extra.investment_note, 600),
    floorRule: missing(extra.floor_price_rule?.note) ? '' : clean(extra.floor_price_rule.note, 400),
    progressBasis: missing(extra.progress_basis) ? '' : clean(extra.progress_basis, 500),
    serviceSteps: (Array.isArray(extra.makaug_service_steps) ? extra.makaug_service_steps : []).map((step) => clean(step, 180)).filter((step) => step && !missing(step)).slice(0, 6),
    completion: project.completion_date ? formatDate(project.completion_date, 'en') : '',
    progress: project.construction_progress == null || project.construction_progress === '' || !Number.isFinite(Number(project.construction_progress)) ? null : Number(project.construction_progress),
    months: Number(project.payment_plan_months) > 0 ? Number(project.payment_plan_months) : null,
    homes: Number(project.units_total) > 0 ? Number(project.units_total) : null,
    homeSummary: beds.length ? `${beds.join(', ').replace(/, ([^,]*)$/, ' and $1')} bedroom` : '',
    signingLabel: signing ? `${signing.percent}% on signing` : '',
    priceUsd: units.find((unit) => unit.usd)?.usd || '',
    priceUgx: money(project.launch_price_ugx, 'UGX') || units.find((unit) => unit.ugx)?.ugx || '',
    hasCoordinates: Number.isFinite(Number(project.latitude)) && Number.isFinite(Number(project.longitude)),
    mapLink: Number.isFinite(Number(project.latitude)) && Number.isFinite(Number(project.longitude))
      ? `https://www.openstreetmap.org/?mlat=${project.latitude}&mlon=${project.longitude}#map=17/${project.latitude}/${project.longitude}`
      : '',
    url: project.slug ? projectUrl(project) : '',
    hero,
    gallery: images.filter((image) => image !== hero && image.kind !== 'construction_photo' && image.kind !== 'location_map'),
    construction: images.filter((image) => image.kind === 'construction_photo'),
    sketch: images.find((image) => image.kind === 'location_map') || null,
    plans,
    typicalPlan: plans.find((plan) => plan.unit_key === 'typical') || null,
    portrait: portraitUrl ? { path: localAssetPath(portraitUrl) } : (agentPhoto ? { path: agentPhoto } : null),
    update: (Array.isArray(extra.construction_updates) ? extra.construction_updates : []).find((item) => !missing(item?.title) || !missing(item?.note)) || null,
    managed: extra.contact_mode === 'makaug_managed'
  };
}

function openDoc(model) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: `${model.name} - makaug.com off-plan`,
      Author: 'makaug.com',
      Subject: [model.name, model.areaLine].filter(Boolean).join(', ')
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

function paintCover(doc, image, x, y, w, h) {
  if (!image?.path) return false;
  doc.save();
  doc.rect(x, y, w, h).clip();
  doc.image(image.path, x, y, { cover: [w, h], align: 'center', valign: 'center' });
  doc.restore();
  return true;
}

function paintFit(doc, image, x, y, w, h) {
  if (!image?.path) return false;
  doc.save();
  doc.rect(x, y, w, h).fill(WHITE);
  doc.rect(x, y, w, h).clip();
  doc.image(image.path, x, y, { fit: [w, h], align: 'center', valign: 'center' });
  doc.restore();
  return true;
}

function footer(doc, page, label) {
  text(doc, 'makaug.com', 36, H - 26, 120, 8, 'Bold', GREEN, { lineBreak: false, height: 12 });
  text(doc, label, 160, H - 26, 300, 8, 'Reg', MUTED, { align: 'center', lineBreak: false, height: 12 });
  text(doc, String(page), W - 64, H - 26, 28, 8, 'Reg', MUTED, { align: 'right', lineBreak: false, height: 12 });
}

function head(doc, model, section) {
  doc.rect(0, 0, W, H).fill(PAPER);
  text(doc, 'makaug.com', 36, 20, 140, 9, 'Bold', GREEN, { lineBreak: false, height: 12 });
  text(doc, [model.name, section].filter(Boolean).join('  ·  '), 180, 21, 378, 8, 'Reg', MUTED, { align: 'right', lineBreak: false, height: 12 });
  doc.moveTo(36, 38).lineTo(W - 36, 38).lineWidth(0.7).strokeColor(GOLD).stroke();
}

function drawCover(doc, model) {
  doc.rect(0, 0, W, H).fill(PAPER);
  const split = Boolean(model.hero?.path);
  if (split) paintCover(doc, model.hero, 300, 0, W - 300, H);
  const width = split ? 246 : 520;
  text(doc, 'makaug.com', 32, 36, width, 12, 'Bold', GREEN, { lineBreak: false, height: 16 });
  text(doc, 'OFF-PLAN PROJECT', 32, 58, width, 8, 'Semi', GOLD, { tracking: 1.3, lineBreak: false, height: 12 });
  let y = text(doc, model.name, 32, 84, width, split ? 32 : 36, 'Bold', INK, { height: 84 }) + 8;
  if (model.areaLine) y = text(doc, model.areaLine, 32, y, width, 12, 'Reg', MUTED, { height: 18 }) + 4;
  if (model.address) y = text(doc, model.address, 32, y, width, 8.5, 'Reg', MUTED, { height: 28 }) + 8;
  if (model.developer) y = text(doc, model.developer, 32, y, width, 9, 'Semi', INK, { height: 16 }) + 10;
  if (model.lede) y = text(doc, model.lede, 32, y + 6, width, 9.5, 'Reg', INK, { height: split ? 130 : 180, lineGap: 2 }) + 16;
  const primary = model.priceUsd || model.priceUgx;
  if (primary) {
    doc.roundedRect(32, y, Math.min(width, 320), model.priceUsd && model.priceUgx ? 78 : 64, 8).fill(WHITE);
    text(doc, 'FROM', 46, y + 10, width - 28, 8, 'Semi', GOLD, { tracking: 1.1, lineBreak: false, height: 12 });
    text(doc, primary, 46, y + 26, width - 28, 16, 'Bold', GREEN, { lineBreak: false, height: 20 });
    if (model.priceUsd && model.priceUgx) text(doc, `${model.priceUgx} indicative`, 46, y + 48, width - 28, 8, 'Reg', MUTED, { height: 16 });
    y += (model.priceUsd && model.priceUgx ? 78 : 64) + 18;
  }
  const facts = [
    model.homes ? [`${model.homes} homes`, model.homeSummary] : null,
    model.completion && !missing(model.completion) ? [model.completion, 'Expected handover'] : null,
    model.months ? [`${model.months} months`, model.signingLabel || 'Payment period'] : null
  ].filter((fact) => fact && fact[0] && !missing(fact[0]));
  facts.forEach((fact) => {
    if (y > 760) return;
    doc.rect(32, y, 3, fact[1] ? 32 : 16).fill(GOLD);
    text(doc, fact[0], 44, y, width - 16, 11, 'Bold', INK, { lineBreak: false, height: 16 });
    if (fact[1]) text(doc, fact[1], 44, y + 16, width - 16, 8, 'Reg', MUTED, { lineBreak: false, height: 12 });
    y += fact[1] ? 48 : 28;
  });
  if (model.hero?.kind === 'artist_impression') {
    text(doc, 'Artist’s impression. Final finishes may differ.', 32, H - 36, width, 8, 'Reg', MUTED, { height: 20 });
  }
}

function drawStory(doc, model, page) {
  head(doc, model, 'The development');
  footer(doc, page, model.areaLine || model.name);
  text(doc, 'The development', 36, 52, 520, 20, 'Bold', INK, { lineBreak: false, height: 26 });
  let y = model.description ? text(doc, model.description, 36, 86, 523, 9.5, 'Reg', INK, { height: 220, lineGap: 2 }) + 16 : 86;
  model.keyFacts.forEach((item) => {
    if (y > 700) return;
    text(doc, item.label, 36, y, 523, 7.5, 'Semi', GREEN, { tracking: 0.5, lineBreak: false, height: 11 });
    y = text(doc, item.value, 36, y + 12, 523, 9, 'Reg', INK, { height: 34 }) + 8;
  });
  if (!model.standaloneLocation && model.areaOverview && y < 700) {
    y = text(doc, model.areaOverview, 36, y, 523, 9, 'Reg', INK, { height: 70, lineGap: 1 }) + 10;
  }
  if (model.progress != null && y < 690) {
    text(doc, 'Construction so far', 36, y + 4, 400, 12, 'Bold', INK, { lineBreak: false, height: 16 });
    text(doc, `${Math.round(model.progress)}%`, 430, y + 4, 129, 12, 'Bold', GREEN, { align: 'right', lineBreak: false, height: 16 });
    doc.roundedRect(36, y + 26, 523, 8, 4).fill('#e3e8e2');
    doc.roundedRect(36, y + 26, Math.max(8, 523 * Math.min(100, model.progress) / 100), 8, 4).fill(GREEN);
    y += 42;
    if (model.progressBasis) y = text(doc, model.progressBasis, 36, y, 523, 8.5, 'Reg', MUTED, { height: 48, lineGap: 1 }) + 8;
  }
  if (model.amenities.length && y < 640) {
    text(doc, 'In the building', 36, y, 520, 13, 'Bold', INK, { lineBreak: false, height: 16 });
    y += 22;
    model.amenities.forEach((amenity, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const top = y + row * 18;
      if (top > 760) return;
      doc.rect(36 + col * 268, top + 4, 6, 6).fill(GREEN);
      text(doc, amenity, 48 + col * 268, top, 240, 8.5, 'Reg', INK, { lineBreak: false, height: 12 });
    });
  }
}

function chunk(list, size) {
  const pages = [];
  for (let index = 0; index < list.length; index += size) pages.push(list.slice(index, index + size));
  return pages;
}

function drawHomes(doc, model, units, page, first) {
  head(doc, model, 'Homes');
  footer(doc, page, 'Unit types and prices');
  text(doc, 'Homes and prices', 36, 52, 520, 20, 'Bold', INK, { lineBreak: false, height: 26 });
  let y = 84;
  if (first && model.floorRule) y = text(doc, model.floorRule, 36, y, 523, 8.5, 'Reg', MUTED, { height: 36, lineGap: 1 }) + 8;
  units.forEach((unit) => {
    doc.roundedRect(36, y, 523, unit.plan ? 168 : 92, 8).fill(WHITE);
    if (unit.plan) paintFit(doc, unit.plan, 48, y + 12, 140, 144);
    const x = unit.plan ? 204 : 52;
    const textWidth = unit.plan ? 330 : 480;
    text(doc, unit.label || 'Home', x, y + 14, textWidth, 13, 'Bold', INK, { height: 32 });
    text(doc, unit.usd || unit.ugx, x, y + 48, textWidth, 14, 'Bold', GREEN, { lineBreak: false, height: 18 });
    if (unit.usd && unit.ugx) text(doc, `${unit.ugx} indicative`, x, y + 68, textWidth, 8.5, 'Reg', MUTED, { lineBreak: false, height: 12 });
    const meta = [
      unit.sizeLabel || (unit.size ? `${unit.size} sq m` : ''),
      Number.isFinite(unit.bedrooms) && unit.bedrooms > 0 ? `${unit.bedrooms} bedroom${unit.bedrooms === 1 ? '' : 's'}` : '',
      Number.isFinite(unit.bathrooms) && unit.bathrooms > 0 ? `${unit.bathrooms} bathroom${unit.bathrooms === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join('   ·   ');
    if (meta) text(doc, meta, x, y + (unit.usd && unit.ugx ? 86 : 72), textWidth, 9, 'Semi', INK, { lineBreak: false, height: 14 });
    const detail = [unit.living, unit.balcony].filter(Boolean).join(' · ');
    if (detail) text(doc, detail, x, y + 106, textWidth, 8.5, 'Reg', MUTED, { height: 22 });
    if (unit.fee) text(doc, `Service charge ${unit.fee}`, x, y + 132, textWidth, 8.5, 'Reg', INK, { lineBreak: false, height: 14 });
    y += (unit.plan ? 168 : 92) + 12;
  });
}

function drawPayment(doc, model, page) {
  head(doc, model, 'Payment');
  footer(doc, page, 'Payment plan and timing');
  text(doc, model.payments.length ? 'How the price is paid' : 'Timing', 36, 52, 520, 20, 'Bold', INK, { height: 26 });
  let y = 90;
  model.payments.slice(0, 4).forEach((item, index) => {
    doc.circle(50, y + 12, 11).fill(GREEN);
    text(doc, String(index + 1), 40, y + 6, 20, 9, 'Bold', WHITE, { align: 'center', lineBreak: false, height: 12 });
    text(doc, item.label, 72, y, 480, 11, 'Bold', INK, { lineBreak: false, height: 16 });
    const detail = item.due || (Number.isFinite(item.percent) && item.percent > 0 ? `${item.percent}%` : '');
    if (detail) text(doc, detail, 72, y + 18, 480, 8.5, 'Reg', MUTED, { height: 22 });
    y += detail ? 52 : 36;
  });
  if (model.timeline.length && y < 620) {
    text(doc, 'Timing', 36, y, 520, 14, 'Bold', INK, { lineBreak: false, height: 18 });
    y += 24;
    model.timeline.slice(0, 5).forEach((step) => {
      doc.circle(46, y + 6, 4).fill(step.status === 'done' ? GREEN : GOLD);
      const when = step.date ? formatDate(step.date, 'en') : '';
      text(doc, when && !missing(when) ? `${when}  —  ${clean(step.label, 140)}` : clean(step.label, 160), 60, y, 490, 9, 'Reg', INK, { lineBreak: false, height: 14 });
      y += 24;
    });
    y += 8;
  }
  if (model.investment && y < 680) {
    doc.roundedRect(36, y, 523, 72, 8).fill('#fff8ea');
    text(doc, 'Developer estimate, not a promise', 50, y + 8, 490, 8, 'Semi', GOLD, { lineBreak: false, height: 12 });
    text(doc, model.investment, 50, y + 24, 490, 8.5, 'Reg', INK, { height: 40, lineGap: 1 });
    y += 84;
  }
  model.charges.slice(0, 3).forEach((charge) => {
    if (y > 760) return;
    text(doc, charge.label, 36, y, 523, 8, 'Semi', GREEN, { lineBreak: false, height: 12 });
    y = text(doc, charge.value, 36, y + 12, 523, 8.5, 'Reg', INK, { height: 28 }) + 8;
  });
}

function drawLocation(doc, model, map, page) {
  head(doc, model, 'Location');
  footer(doc, page, model.hasCoordinates && map ? OSM_ATTRIBUTION : model.areaLine);
  text(doc, model.areaLine || 'Location', 36, 50, 520, 18, 'Bold', INK, { height: 24 });
  let y = 80;
  if (model.address) y = text(doc, model.address, 36, y, 523, 9, 'Reg', MUTED, { height: 16 }) + 6;
  if (model.areaOverview) y = text(doc, model.areaOverview, 36, y, 523, 8.5, 'Reg', INK, { height: 72, lineGap: 1 }) + 8;
  if (map && model.hasCoordinates) {
    const mapH = Math.round(523 * MAP_H / MAP_W);
    doc.image(map, 36, y, { width: 523, height: mapH });
    y += mapH + 6;
    text(doc, `Map data ${OSM_ATTRIBUTION}. The pin is the project coordinate.`, 36, y, 360, 7.5, 'Reg', MUTED, { height: 18 });
    if (model.mapLink) text(doc, 'Open this pin on OpenStreetMap', 360, y, 199, 8, 'Bold', GREEN, { align: 'right', lineBreak: false, height: 12, link: model.mapLink });
    y += 22;
  } else if (model.sketch?.path) {
    paintCover(doc, model.sketch, 36, y, 523, 180);
    y += 184;
    if (model.sketch.caption) y = text(doc, model.sketch.caption, 36, y, 523, 8, 'Reg', MUTED, { height: 20 }) + 6;
  }
  model.places.slice(0, 8).forEach((place, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 36 + col * 268;
    const top = y + row * 32;
    if (top > 780) return;
    text(doc, place.name, x, top, 250, 8.5, 'Semi', INK, { lineBreak: false, height: 12 });
    const meta = [place.category, kmLabel(place.km)].filter(Boolean).join('  ·  ');
    if (meta) text(doc, meta, x, top + 13, 250, 7.5, 'Reg', MUTED, { lineBreak: false, height: 11 });
  });
}

function drawGallery(doc, model, page) {
  head(doc, model, 'Gallery');
  footer(doc, page, 'Project images');
  text(doc, 'The building', 36, 50, 400, 18, 'Bold', INK, { lineBreak: false, height: 22 });
  const images = model.gallery.slice(0, 5);
  let y = 80;
  if (images.length === 1) {
    paintCover(doc, images[0], 36, y, 523, 360);
    text(doc, images[0].caption, 36, y + 368, 523, 8, 'Reg', MUTED, { height: 28 });
    return;
  }
  if (images.length === 2) {
    images.forEach((image) => {
      paintCover(doc, image, 36, y, 523, 250);
      y = text(doc, image.caption, 36, y + 256, 523, 8, 'Reg', MUTED, { height: 20 }) + 12;
    });
    return;
  }
  paintCover(doc, images[0], 36, y, 523, 220);
  y = text(doc, images[0].caption, 36, y + 226, 523, 7.5, 'Reg', MUTED, { height: 20 }) + 8;
  images.slice(1, 5).forEach((image, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 36 + col * 268;
    const top = y + row * 176;
    paintCover(doc, image, x, top, 255, 140);
    text(doc, image.caption, x, top + 144, 255, 7.5, 'Reg', MUTED, { height: 24 });
  });
}

function drawSite(doc, model, page) {
  head(doc, model, 'On site');
  footer(doc, page, 'Construction');
  text(doc, model.update?.title || 'On site', 36, 50, 520, 18, 'Bold', INK, { height: 24 });
  let y = 78;
  if (model.update?.note && !missing(model.update.note)) y = text(doc, model.update.note, 36, y, 523, 8.5, 'Reg', INK, { height: 48, lineGap: 1 }) + 8;
  model.construction.slice(0, 9).forEach((image, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 36 + col * 176;
    const top = y + row * 168;
    paintCover(doc, image, x, top, 168, 112);
    text(doc, image.caption, x, top + 116, 168, 7, 'Reg', MUTED, { height: 28 });
  });
}

function drawPlans(doc, model, page) {
  head(doc, model, 'Floor plans');
  footer(doc, page, 'Plans supplied by the developer');
  text(doc, 'Floor plans', 36, 50, 520, 18, 'Bold', INK, { height: 24 });
  const unitPlans = model.units.map((unit) => unit.plan).filter(Boolean);
  const typical = model.typicalPlan;
  const extras = model.plans.filter((plan) => plan !== typical && !unitPlans.includes(plan));
  let y = 80;
  if (typical) {
    if (typical.caption) y = text(doc, typical.caption, 36, y, 523, 8, 'Reg', MUTED, { height: 20 }) + 4;
    paintFit(doc, typical, 36, y, 523, 300);
    y += 312;
  }
  const rest = typical ? unitPlans : model.plans;
  const shown = (typical ? rest : extras.concat(rest)).filter((plan, index, list) => list.indexOf(plan) === index).slice(0, typical ? 3 : 4);
  shown.forEach((plan, index) => {
    const columns = shown.length > 2 ? 3 : shown.length;
    const width = columns === 1 ? 523 : columns === 2 ? 250 : 168;
    const x = 36 + (index % columns) * (width + 12);
    const row = Math.floor(index / columns);
    const top = y + row * 190;
    paintFit(doc, plan, x, top, width, columns === 1 ? 280 : 140);
    text(doc, plan.caption, x, top + (columns === 1 ? 286 : 144), width, 7.5, 'Reg', MUTED, { height: 28 });
  });
  if (y < 730) text(doc, 'Plans are for guidance. Confirm dimensions and the plan attached to the sale agreement.', 36, Math.max(y + 16, 700), 523, 8, 'Reg', MUTED, { height: 22 });
}

function drawEnquire(doc, model, qr, page) {
  head(doc, model, 'Enquire');
  footer(doc, page, 'How to enquire');
  text(doc, model.contactName ? 'Talk to the project' : 'Enquire', 36, 52, 400, 20, 'Bold', INK, { height: 26 });
  let y = 90;
  if (model.portrait?.path) paintCover(doc, model.portrait, 36, y, 120, 140);
  const x = model.portrait?.path ? 172 : 36;
  const width = model.portrait?.path ? 280 : 400;
  let line = y;
  if (model.contactName) line = text(doc, model.contactName, x, line, width, 16, 'Bold', INK, { height: 22 }) + 4;
  const role = [model.contactRole, model.developer].filter(Boolean).join(' · ');
  if (role) line = text(doc, role, x, line, width, 9, 'Reg', MUTED, { height: 24 }) + 6;
  if (model.phones.founder) line = text(doc, `WhatsApp  ${model.phones.founder}`, x, line, width, 11, 'Bold', GREEN, { lineBreak: false, height: 16, link: model.phones.founderLink || undefined }) + 4;
  if (model.phones.sales) line = text(doc, `Sales desk  ${model.phones.sales}`, x, line, width, 10, 'Semi', INK, { lineBreak: false, height: 14, link: model.phones.salesLink || undefined }) + 4;
  if (model.contactEmail) line = text(doc, model.contactEmail, x, line, width, 9, 'Reg', INK, { lineBreak: false, height: 14, link: model.contactEmail === 'info@makaug.com' ? 'mailto:info@makaug.com' : `mailto:${model.contactEmail}` }) + 4;
  if (model.contactWebsite) line = text(doc, model.contactWebsite, x, line, width, 9, 'Reg', GREEN, { lineBreak: false, height: 14, link: model.contactWebsite }) + 4;
  if (qr && model.url) {
    doc.image(qr, 470, y, { width: 86, height: 86 });
    text(doc, 'Project page', 456, y + 90, 110, 8, 'Reg', MUTED, { align: 'center', lineBreak: false, height: 12 });
  }
  y = Math.max(line, model.portrait?.path ? y + 156 : line, qr ? y + 110 : line) + 16;
  if (model.bio) y = text(doc, model.bio, 36, y, 523, 9, 'Reg', INK, { height: 40 }) + 8;
  const steps = model.serviceSteps.length ? model.serviceSteps : [
    model.url ? 'Open the live project on makaug.com.' : '',
    model.phones.founder ? `Message ${model.contactName || 'the project contact'} on WhatsApp to ask about a visit.` : '',
    model.units.length ? 'Ask for the home and the written price before you pay.' : '',
    model.floorRule ? 'Confirm the unit, the floor and the written price.' : '',
    'Have your own lawyer read the agreement before you pay.',
    model.charges.length ? `Budget separately for ${model.charges.map((charge) => clean(charge.label, 40).toLowerCase()).join(' and ')}.` : ''
  ].filter((step, index, list) => step && !missing(step) && list.indexOf(step) === index).slice(0, 5);
  if (steps.length) {
    text(doc, 'How to enquire', 36, y, 520, 14, 'Bold', INK, { lineBreak: false, height: 18 });
    y += 24;
    steps.forEach((step, index) => {
      text(doc, String(index + 1), 36, y, 18, 11, 'Bold', GREEN, { lineBreak: false, height: 14 });
      y = text(doc, step, 58, y, 500, 9, 'Reg', INK, { height: 24 }) + 10;
    });
  }
  if (model.url) y = text(doc, model.url.replace(/^https:\/\//, ''), 36, y + 6, 523, 9, 'Bold', GREEN, { lineBreak: false, height: 14, link: model.url }) + 10;
  text(doc, 'Prices, availability and handover dates can change. makaug.com publishes the developer’s figures. This brochure is not an offer.', 36, Math.min(y, 760), 523, 8.5, 'Reg', MUTED, { height: 36, lineGap: 1 });
}

function pdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function editorialBrochureBuffer(projectInput, options = {}) {
  const model = prepareModel(projectInput, options);
  const map = options.mapBuffer || null;
  model.standaloneLocation = Boolean((map && model.hasCoordinates) || model.sketch || model.places.length);
  let qr = null;
  if (model.url) {
    try {
      qr = await QRCode.toBuffer(model.url, { type: 'png', margin: 0, width: 240, color: { dark: '#117a3d', light: '#ffffff' } });
    } catch (_error) {
      qr = null;
    }
  }
  const sections = [
    (doc, page) => drawCover(doc, model, page),
    (model.description || model.keyFacts.length || model.progress != null || model.amenities.length || (!model.standaloneLocation && model.areaOverview)) ? (doc, page) => drawStory(doc, model, page) : null,
    ...chunk(model.units, 3).map((units, index) => (doc, page) => drawHomes(doc, model, units, page, index === 0)),
    (model.payments.length || model.timeline.length || model.investment || model.charges.length) ? (doc, page) => drawPayment(doc, model, page) : null,
    model.standaloneLocation ? (doc, page) => drawLocation(doc, model, map, page) : null,
    model.gallery.length ? (doc, page) => drawGallery(doc, model, page) : null,
    (model.construction.length || model.update) ? (doc, page) => drawSite(doc, model, page) : null,
    model.plans.length ? (doc, page) => drawPlans(doc, model, page) : null,
    (doc, page) => drawEnquire(doc, model, qr, page)
  ].filter(Boolean);
  const doc = openDoc(model);
  sections.forEach((draw, index) => {
    if (index) nextPage(doc);
    draw(doc, index + 1);
  });
  return pdfBuffer(doc);
}

module.exports = {
  MAP_H,
  MAP_W,
  editorialBrochureBuffer,
  prepareModel
};
