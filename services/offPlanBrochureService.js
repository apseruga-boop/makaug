'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { normalizeDevelopmentRow } = require('./offPlanService');
const { brochureLanguagePack, interpolate, normalizeBrochureLanguage } = require('./offPlanBrochureI18n');

const BRAND_GREEN = '#117a3d';
const BRAND_GOLD = '#e9a321';
const INK = '#182230';
const MUTED = '#667085';
const PALE = '#f4f8f3';
const FONT_ROOT = path.resolve(__dirname, '..', 'assets', 'fonts');
const FONT_SET_BY_LANGUAGE = {
  ar: {
    regular: path.join(FONT_ROOT, 'NotoSansArabic-Variable.ttf'),
    bold: path.join(FONT_ROOT, 'NotoSansArabic-Variable.ttf')
  },
  am: {
    regular: path.join(FONT_ROOT, 'NotoSansEthiopic-Variable.ttf'),
    bold: path.join(FONT_ROOT, 'NotoSansEthiopic-Variable.ttf')
  }
};
const DEFAULT_FONT_SET = {
  regular: path.join(FONT_ROOT, 'NotoSans-Variable.ttf'),
  bold: path.join(FONT_ROOT, 'NotoSans-Variable.ttf')
};

function cleanText(value, max = 4000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function formatMoney(value, currency = 'UGX', copy = ENGLISH_FALLBACK) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return copy.priceRequest;
  return `${cleanText(currency, 3).toUpperCase()} ${Math.round(amount).toLocaleString('en-UG')}`;
}

const ENGLISH_FALLBACK = brochureLanguagePack('en');

function formatDate(value, language = 'en', copy = brochureLanguagePack(language)) {
  if (!value) return copy.toVerify;
  const dateOnlyMatch = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/) : null;
  const date = value instanceof Date
    ? new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), 12))
    : dateOnlyMatch
      ? new Date(Date.UTC(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]), 12))
      : new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, 80);
  const locale = { lg: 'lg-UG', sw: 'sw-UG', am: 'am-ET', ar: 'ar-UG' }[normalizeBrochureLanguage(language)] || 'en-UG';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Kampala'
  }).format(date);
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function projectUrl(project) {
  return `${publicBaseUrl()}/off-plan/${encodeURIComponent(project.slug)}`;
}

function agentUrl(agent = {}) {
  return agent.id ? `${publicBaseUrl()}/agents/${encodeURIComponent(agent.id)}` : projectUrl({ slug: '' });
}

function googleMapsUrl(project = {}) {
  const lat = Number(project.latitude);
  const lng = Number(project.longitude);
  const query = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat},${lng}`
    : [project.area, project.district, 'Uganda'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function localAssetPath(url) {
  const clean = cleanText(url, 2000).split('?')[0];
  if (!clean.startsWith('/assets/')) return null;
  const relative = clean.replace(/^\/+/, '');
  const candidate = path.resolve(__dirname, '..', relative);
  const assetsRoot = path.resolve(__dirname, '..', 'assets');
  if (!candidate.startsWith(`${assetsRoot}${path.sep}`) || !fs.existsSync(candidate)) return null;
  return candidate;
}

async function safeRemoteImageBuffer(url) {
  const clean = cleanText(url, 2000);
  if (!/^https:\/\/media\.makaug\.com\//i.test(clean)) return null;
  try {
    const response = await fetch(clean, { signal: AbortSignal.timeout(3500) });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !/^image\/(?:jpeg|png)/i.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length && bytes.length <= 8 * 1024 * 1024 ? bytes : null;
  } catch (_error) {
    return null;
  }
}

async function googleStaticMapBuffer(project = {}) {
  const key = cleanText(process.env.GOOGLE_MAPS_STATIC_API_KEY || process.env.GOOGLE_MAPS_API_KEY, 500);
  const lat = Number(project.latitude);
  const lng = Number(project.longitude);
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const query = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: project.extra_fields?.map_precision === 'area_centroid' ? '12' : '15',
    size: '900x420',
    scale: '1',
    maptype: 'roadmap',
    markers: `color:red|${lat},${lng}`,
    key
  });
  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${query}`, { signal: AbortSignal.timeout(4500) });
    if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/')) {
      const responseText = await response.text().catch(() => '');
      console.warn('[off-plan-brochure-map] Static map unavailable', { status: response.status, body: cleanText(responseText, 180) });
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length && bytes.length <= 8 * 1024 * 1024 ? bytes : null;
  } catch (error) {
    console.warn('[off-plan-brochure-map] Static map request failed', { message: cleanText(error?.message, 180) });
    return null;
  }
}

function areaGroup(place = {}) {
  const source = cleanText(place.category, 100).toLowerCase();
  if (/school|child|nursery|kindergarten/.test(source)) return 'schools';
  if (/hospital|clinic|health|medical/.test(source)) return 'healthcare';
  if (/university|college|tertiary/.test(source)) return 'universities';
  if (/market|shop|mall|supermarket|retail/.test(source)) return 'shopping';
  if (/airport|transport|bus|ferry/.test(source)) return 'transport';
  return 'parks';
}

function distanceKmBetween(first = {}, second = {}) {
  const lat1 = Number(first.latitude ?? first.lat);
  const lng1 = Number(first.longitude ?? first.lng);
  const lat2 = Number(second.latitude ?? second.lat);
  const lng2 = Number(second.longitude ?? second.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceFromProject(project = {}, place = {}) {
  const supplied = Number(place.distance_km);
  if (Number.isFinite(supplied)) return supplied;
  return distanceKmBetween(project, place);
}

function formatApproximateDistance(project, place, language = 'en') {
  const copy = brochureLanguagePack(language);
  const distance = distanceFromProject(project, place);
  if (!Number.isFinite(distance)) return copy.distanceVerify;
  const display = distance < 0.1 ? '<0.1' : distance.toFixed(distance < 10 ? 1 : 0);
  return interpolate(copy.approximateDistance, { distance: display });
}

function computeMortgageEstimate({ principal, annualRate, years, arrangementFeePct = 0 } = {}) {
  const safePrincipal = Number(principal);
  const safeRate = Number(annualRate);
  const safeYears = Number(years);
  if (!(safePrincipal > 0) || !(safeRate > 0) || !(safeYears > 0)) return null;
  const months = Math.max(1, Math.round(safeYears * 12));
  const monthlyRate = safeRate / 100 / 12;
  const factor = (1 + monthlyRate) ** months;
  const monthly = safePrincipal * monthlyRate * factor / (factor - 1);
  const arrangementFee = safePrincipal * Math.max(0, Number(arrangementFeePct) || 0) / 100;
  const repaymentBeforeFee = monthly * months;
  return {
    principal: safePrincipal,
    years: safeYears,
    months,
    monthly,
    interest: repaymentBeforeFee - safePrincipal,
    arrangementFee,
    total: repaymentBeforeFee + arrangementFee
  };
}

function registerBrochureFonts(doc, language) {
  const fonts = FONT_SET_BY_LANGUAGE[normalizeBrochureLanguage(language)] || DEFAULT_FONT_SET;
  for (const fontPath of [fonts.regular, fonts.bold]) {
    if (!fs.existsSync(fontPath)) throw new Error(`Off-plan brochure font is missing: ${path.basename(fontPath)}`);
  }
  doc.registerFont('Brochure-Regular', fonts.regular);
  doc.registerFont('Brochure-Bold', fonts.bold);
  doc.registerFont('Brochure-Oblique', fonts.regular);
}

function preserveArabicWordSpacing(doc, language) {
  if (normalizeBrochureLanguage(language) !== 'ar') return;
  const writeText = doc.text.bind(doc);
  doc.text = (text, ...args) => {
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
      args[args.length - 1] = { wordSpacing: 1, ...last };
    } else {
      args.push({ wordSpacing: 1 });
    }
    return writeText(text, ...args);
  };
}

function localizedProjectText(project, field, language, fallback) {
  const code = normalizeBrochureLanguage(language);
  if (code === 'en') return cleanText(project[field], 7000) || fallback;
  const translated = project.extra_fields?.translations?.[code]?.[field];
  if (cleanText(translated, 7000)) return cleanText(translated, 7000);
  if (project.slug === 'entebbe-victoria-palms') {
    const copy = brochureLanguagePack(code);
    if (field === 'description') return copy.previewDescription;
    if (field === 'area_overview') return copy.areaOverview;
  }
  return fallback;
}

function addHeader(doc, title = '', copy = ENGLISH_FALLBACK) {
  const previousY = doc.y;
  doc.save();
  doc.rect(0, 0, doc.page.width, 64).fill(BRAND_GREEN);
  doc.fillColor('#ffffff').font('Brochure-Bold').fontSize(21).text('makaug', 44, 20, { continued: true, lineBreak: false });
  doc.fillColor(BRAND_GOLD).text('.com', { lineBreak: false });
  if (title) doc.fillColor('#d9efe0').font('Brochure-Regular').fontSize(9).text(cleanText(title, 70), 300, 27, { width: 250, align: 'right', lineBreak: false });
  doc.restore();
  doc.y = previousY;
}

function addFooter(doc, project, copy = ENGLISH_FALLBACK) {
  const y = doc.page.height - 44;
  const previousY = doc.y;
  const previousBottomMargin = doc.page.margins.bottom;
  doc.save();
  // PDFKit automatically creates a new page when text enters the bottom margin.
  // The footer deliberately occupies that margin, so suspend it while drawing.
  doc.page.margins.bottom = 0;
  doc.moveTo(42, y - 10).lineTo(doc.page.width - 42, y - 10).strokeColor('#d9e2dc').stroke();
  doc.fillColor(MUTED).font('Brochure-Regular').fontSize(8)
    .text(copy.footer, 42, y, { width: 300, height: 12, lineBreak: false })
    .fillColor(BRAND_GREEN).text('makaug.com/off-plan', 345, y, { width: 208, height: 12, align: 'right', link: projectUrl(project), lineBreak: false });
  doc.page.margins.bottom = previousBottomMargin;
  doc.restore();
  doc.y = previousY;
}

function imageCover(doc, imagePath, x, y, width, height) {
  doc.save();
  doc.roundedRect(x, y, width, height, 16).clip();
  doc.image(imagePath, x, y, { width, height, cover: [width, height], align: 'center', valign: 'center' });
  doc.restore();
}

function addPage(doc, project, title, copy = ENGLISH_FALLBACK) {
  doc.addPage();
  addHeader(doc, title, copy);
  addFooter(doc, project, copy);
  doc.y = 88;
}

function writeSectionTitle(doc, title, y = doc.y, rtl = false) {
  doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(18).text(title, 44, y, { width: 505, align: rtl ? 'right' : 'left' });
  doc.moveDown(0.5);
}

function progressBar(doc, label, value, x, y, width, copy = ENGLISH_FALLBACK) {
  const known = value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const progress = known ? Math.max(0, Math.min(100, Number(value))) : 0;
  doc.fillColor(INK).font('Brochure-Bold').fontSize(10).text(label, x, y, { width: width - 50 });
  doc.fillColor(MUTED).font('Brochure-Regular').text(known ? `${progress}%` : copy.toVerify, x + width - 70, y, { width: 70, align: 'right' });
  doc.roundedRect(x, y + 20, width, 9, 4).fill('#e4ebe6');
  if (known && progress > 0) doc.roundedRect(x, y + 20, width * progress / 100, 9, 4).fill(BRAND_GREEN);
}

function safeDescription(project, language, copy) {
  return localizedProjectText(project, 'description', language, copy.descriptionFallback);
}

function buildOffPlanBrochure(projectInput, output, options = {}) {
  const project = normalizeDevelopmentRow(projectInput);
  const agent = options.agentProfile || null;
  const language = normalizeBrochureLanguage(options.language);
  const copy = brochureLanguagePack(language);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 88, right: 44, bottom: 64, left: 44 }, info: { Title: `${project.name} - makaug.com ${copy.project}`, Author: 'makaug.com', Subject: copy.project } });
  registerBrochureFonts(doc, language);
  preserveArabicWordSpacing(doc, language);
  if (output && typeof output.write === 'function') doc.pipe(output);

  const imagePaths = project.images.map((image) => ({ ...image, path: localAssetPath(image.url) })).filter((image) => image.path);
  addHeader(doc, copy.project, copy);
  addFooter(doc, project, copy);
  if (imagePaths[0]) imageCover(doc, imagePaths[0].path, 42, 90, doc.page.width - 84, 310);
  else doc.roundedRect(42, 90, doc.page.width - 84, 310, 16).fill(PALE);
  doc.fillColor(BRAND_GOLD).font('Brochure-Bold').fontSize(10).text(copy.project.toUpperCase(), 44, 426, { width: 505, align: copy.rtl ? 'right' : 'left' });
  doc.fillColor(INK).font('Brochure-Bold').fontSize(29).text(cleanText(project.name, 220), 44, 448, { width: 510, align: copy.rtl ? 'right' : 'left' });
  doc.fillColor(MUTED).font('Brochure-Regular').fontSize(13).text([project.area, project.district].filter(Boolean).join(', '), 44, doc.y + 8, { width: 505, align: copy.rtl ? 'right' : 'left' });
  const price = project.launch_price_ugx != null
    ? `${copy.from} ${formatMoney(project.launch_price_ugx, 'UGX', copy)}`
    : copy.pricingVerify;
  doc.roundedRect(44, doc.y + 24, 505, 72, 12).fill(PALE);
  doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(19).text(price, 62, doc.y + 48, { width: 470 });

  addPage(doc, project, copy.overview, copy);
  writeSectionTitle(doc, copy.overview, doc.y, copy.rtl);
  doc.fillColor(INK).font('Brochure-Regular').fontSize(11).text(safeDescription(project, language, copy), { width: 505, lineGap: 4, align: copy.rtl ? 'right' : 'left' });
  let y = Math.max(doc.y + 28, 270);
  progressBar(doc, copy.construction, project.construction_progress, 44, y, 235, copy);
  progressBar(doc, copy.homesSold, project.sales_progress, 314, y, 235, copy);
  y += 76;
  const facts = [
    [copy.developer, project.developer_name || copy.toVerify],
    [copy.completion, formatDate(project.completion_date, language, copy)],
    [copy.totalHomes, project.units_total == null ? copy.toVerify : String(project.units_total)],
    [copy.homesAvailable, project.units_available == null ? copy.toVerify : String(project.units_available)],
    [copy.paymentPeriod, project.payment_plan_months ? interpolate(copy.months, { count: project.payment_plan_months }) : copy.toVerify],
    [copy.source, project.source_display_name || copy.partner]
  ];
  facts.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 44 + col * 270;
    const top = y + row * 70;
    doc.fillColor(MUTED).font('Brochure-Bold').fontSize(8).text(label.toUpperCase(), x, top, { width: 235, align: copy.rtl ? 'right' : 'left' });
    doc.fillColor(INK).font('Brochure-Bold').fontSize(12).text(cleanText(value, 220), x, top + 17, { width: 235, align: copy.rtl ? 'right' : 'left' });
  });

  addPage(doc, project, copy.locationArea, copy);
  writeSectionTitle(doc, copy.locationArea, doc.y, copy.rtl);
  const areaOverview = localizedProjectText(project, 'area_overview', language, `${[project.area, project.district].filter(Boolean).join(', ')}. ${copy.areaFallback}`);
  doc.fillColor(INK).font('Brochure-Regular').fontSize(10.5).text(areaOverview, 44, doc.y + 5, { width: 505, lineGap: 4, align: copy.rtl ? 'right' : 'left' });
  const mapTop = Math.min(doc.y + 18, 235);
  if (options.mapImageBuffer) imageCover(doc, options.mapImageBuffer, 44, mapTop, 505, 235);
  else {
    doc.roundedRect(44, mapTop, 505, 235, 14).fill('#e9f1ec');
    doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(18).text(copy.openMaps, 74, mapTop + 84, { width: 445, align: 'center', link: googleMapsUrl(project) });
    doc.fillColor(MUTED).font('Brochure-Regular').fontSize(9).text(copy.mapUnavailable, 74, mapTop + 120, { width: 445, align: 'center' });
  }
  doc.fillColor(MUTED).font('Brochure-Regular').fontSize(8.5).text(project.extra_fields?.map_precision === 'area_centroid'
    ? copy.widerMarker
    : copy.confirmEntrance, 44, mapTop + 246, { width: 505, link: googleMapsUrl(project), align: copy.rtl ? 'right' : 'left' });
  doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(11).text(copy.openMaps, 44, mapTop + 274, { width: 505, link: googleMapsUrl(project), underline: true, align: copy.rtl ? 'right' : 'left' });
  doc.fillColor(MUTED).font('Brochure-Regular').fontSize(8.5).text(copy.servicesContinue, 44, mapTop + 298, { width: 505, lineGap: 3, align: copy.rtl ? 'right' : 'left' });

  addPage(doc, project, copy.familyLife, copy);
  writeSectionTitle(doc, copy.familyLife, doc.y, copy.rtl);
  doc.fillColor(MUTED).font('Brochure-Regular').fontSize(9.5).text(copy.familyIntro, 44, doc.y + 5, { width: 505, lineGap: 3, align: copy.rtl ? 'right' : 'left' });
  const groupedPlaces = new Map();
  project.nearby_places.forEach((place) => {
    const key = areaGroup(place);
    if (!groupedPlaces.has(key)) groupedPlaces.set(key, []);
    groupedPlaces.get(key).push(place);
  });
  const servicesYByColumn = [doc.y + 32, doc.y + 32];
  const groupOrder = ['schools', 'healthcare', 'universities', 'shopping', 'parks', 'transport'];
  groupOrder.filter((groupName) => (groupedPlaces.get(groupName) || []).length).forEach((groupName, groupIndex) => {
    const places = (groupedPlaces.get(groupName) || []).slice(0, 3);
    const column = groupIndex % 2;
    const x = 44 + column * 258;
    const width = 247;
    let servicesY = servicesYByColumn[column];
    if (servicesY > 690) return;
    doc.roundedRect(x, servicesY, width, 28, 8).fill('#e5f2e9');
    doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(10.5).text(copy[groupName], x + 12, servicesY + 8, { width: width - 24, height: 14, ellipsis: true, align: copy.rtl ? 'right' : 'left' });
    servicesY += 35;
    places.forEach((place) => {
      if (servicesY > 718) return;
      doc.roundedRect(x, servicesY, width, 58, 8).fill(PALE);
      doc.fillColor(INK).font('Brochure-Bold').fontSize(8.5).text(cleanText(place.name || copy[groupName], 150), x + 11, servicesY + 7, { width: width - 22, height: 13, ellipsis: true, align: copy.rtl ? 'right' : 'left' });
      doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(7.3).text(formatApproximateDistance(project, place, language), x + 11, servicesY + 23, { width: width - 22, height: 11, ellipsis: true, align: copy.rtl ? 'right' : 'left' });
      const placeNote = language === 'en' ? cleanText(place.note || copy.confirmDetails, 220) : copy.confirmDetails;
      doc.fillColor(MUTED).font('Brochure-Regular').fontSize(7).text(placeNote, x + 11, servicesY + 37, { width: width - 22, height: 15, ellipsis: true, lineGap: 1, link: place.source_url || undefined, align: copy.rtl ? 'right' : 'left' });
      servicesY += 64;
    });
    servicesYByColumn[column] = servicesY + 12;
  });

  addPage(doc, project, copy.homesPayment, copy);
  writeSectionTitle(doc, copy.availableTypes, doc.y, copy.rtl);
  let tableY = doc.y + 8;
  if (!project.unit_types.length) {
    doc.fillColor(MUTED).font('Brochure-Regular').fontSize(11).text(copy.unitVerify, 44, tableY, { width: 505, align: copy.rtl ? 'right' : 'left' });
    tableY += 40;
  } else {
    project.unit_types.forEach((unit, index) => {
      const yRow = tableY + index * 58;
      if (yRow > 530) return;
      doc.roundedRect(44, yRow, 505, 46, 8).fill(index % 2 ? '#ffffff' : PALE);
      const unitLabel = language === 'en' && cleanText(unit.label, 220) ? cleanText(unit.label, 220) : interpolate(copy.homeLabel, { count: unit.bedrooms || '' });
      doc.fillColor(INK).font('Brochure-Bold').fontSize(11).text(unitLabel, 58, yRow + 9, { width: 280, align: copy.rtl ? 'right' : 'left' });
      const priceText = unit.price_ugx
        ? `${formatMoney(unit.price_ugx, 'UGX', copy)}${unit.price_original ? ` ${interpolate(copy.guideSource, { amount: formatMoney(unit.price_original, unit.price_original_currency || project.original_currency, copy) })}` : ''}`
        : unit.price_original
          ? interpolate(copy.sourceSupplied, { amount: formatMoney(unit.price_original, unit.price_original_currency || project.original_currency, copy) })
          : copy.priceRequest;
      doc.fillColor(MUTED).font('Brochure-Regular').fontSize(9).text(priceText, 58, yRow + 25, { width: 450, align: copy.rtl ? 'right' : 'left' });
    });
    tableY += Math.min(project.unit_types.length, 6) * 58 + 18;
  }
  writeSectionTitle(doc, copy.paymentPlan, Math.min(tableY, 545), copy.rtl);
  const paymentLines = project.payment_plan.length
    ? project.payment_plan.map((item) => `${language === 'en' ? cleanText(item.label || copy.milestone) : copy.milestone}: ${item.amount_original ? formatMoney(item.amount_original, item.currency || project.original_currency, copy) : item.kind === 'equal_monthly' ? interpolate(copy.equalInstalments, { count: item.months || project.payment_plan_months || '?' }) : (language === 'en' ? cleanText(item.due || copy.toVerify) : copy.toVerify)}`)
    : [copy.milestonesVerify];
  doc.fillColor(INK).font('Brochure-Regular').fontSize(10).list(paymentLines, 60, doc.y + 8, { width: 475, bulletRadius: 2, textIndent: 12, lineGap: 5, align: copy.rtl ? 'right' : 'left' });
  doc.moveDown(1.2);
  const paymentNote = language === 'en' ? (cleanText(project.extra_fields?.payment_terms_note, 900) || copy.paymentNote) : copy.paymentNote;
  doc.fillColor(MUTED).font('Brochure-Oblique').fontSize(9).text(paymentNote, 44, doc.y, { width: 505, lineGap: 3, align: copy.rtl ? 'right' : 'left' });

  addPage(doc, project, copy.mortgageComparison, copy);
  writeSectionTitle(doc, copy.providers, doc.y, copy.rtl);
  const mortgagePrice = Number(project.launch_price_ugx);
  doc.fillColor(MUTED).font('Brochure-Regular').fontSize(9.5).text(interpolate(copy.mortgageIntro, { price: Number.isFinite(mortgagePrice) ? formatMoney(mortgagePrice, 'UGX', copy) : copy.launchPrice }), 44, doc.y + 5, { width: 505, lineGap: 3, align: copy.rtl ? 'right' : 'left' });
  const mortgageProviders = (options.mortgageProviders || []).slice(0, 3);
  let mortgageY = doc.y + 30;
  (mortgageProviders.length ? mortgageProviders : [{ name: copy.providerFallback, sourceNote: copy.providerFallbackNote }]).forEach((provider) => {
    const rate = Number(provider.residentialRate);
    const deposit = Number(provider.minDepositPct?.residential);
    const maximumYears = Number(provider.maxYears?.residential);
    const years = Number.isFinite(maximumYears) ? Math.min(20, maximumYears) : 20;
    const principal = Number.isFinite(mortgagePrice) && Number.isFinite(deposit) ? mortgagePrice * (1 - deposit / 100) : mortgagePrice;
    const estimate = computeMortgageEstimate({ principal, annualRate: rate, years, arrangementFeePct: provider.arrangementFeePct });
    doc.roundedRect(44, mortgageY, 505, 166, 12).fill(PALE);
    doc.fillColor(INK).font('Brochure-Bold').fontSize(13).text(cleanText(provider.name || copy.providerFallback, 120), 62, mortgageY + 13, { width: 460, align: copy.rtl ? 'right' : 'left' });
    doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(8.5).text(`${copy.rate}: ${Number.isFinite(rate) ? `${rate}%` : copy.quote}   |   ${copy.minimumDeposit}: ${Number.isFinite(deposit) ? `${deposit}%` : copy.confirm}   |   ${copy.termUsed}: ${interpolate(copy.years, { count: years })}`, 62, mortgageY + 36, { width: 460, align: copy.rtl ? 'right' : 'left' });
    if (estimate) {
      doc.fillColor(INK).font('Brochure-Bold').fontSize(9).text(`${copy.loanAmount}: ${formatMoney(estimate.principal, 'UGX', copy)}`, 62, mortgageY + 57, { width: 225, align: copy.rtl ? 'right' : 'left' });
      doc.fillColor(INK).font('Brochure-Bold').fontSize(9).text(`${copy.estimatedMonthly}: ${formatMoney(estimate.monthly, 'UGX', copy)}`, 300, mortgageY + 57, { width: 235, align: 'right' });
      doc.fillColor(MUTED).font('Brochure-Regular').fontSize(8).text(`${copy.estimatedInterest}: ${formatMoney(estimate.interest, 'UGX', copy)}`, 62, mortgageY + 79, { width: 225, align: copy.rtl ? 'right' : 'left' });
      doc.fillColor(MUTED).font('Brochure-Regular').fontSize(8).text(`${copy.arrangementFee}: ${formatMoney(estimate.arrangementFee, 'UGX', copy)}`, 300, mortgageY + 79, { width: 235, align: 'right' });
      doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(9).text(`${copy.totalRepayment}: ${formatMoney(estimate.total, 'UGX', copy)}`, 62, mortgageY + 100, { width: 473, align: copy.rtl ? 'right' : 'left' });
    }
    const providerNote = language === 'en' ? cleanText(provider.sourceNote || copy.providerNote, 420) : copy.providerNote;
    doc.fillColor(MUTED).font('Brochure-Regular').fontSize(7.5).text(providerNote, 62, mortgageY + 121, { width: 460, height: 28, ellipsis: true, lineGap: 2, link: provider.sourceUrl || undefined, align: copy.rtl ? 'right' : 'left' });
    mortgageY += 178;
  });
  doc.fillColor(MUTED).font('Brochure-Oblique').fontSize(8.5).text(copy.mortgageDisclaimer, 44, 696, { width: 505, lineGap: 3, align: copy.rtl ? 'right' : 'left' });

  if (imagePaths.length) {
    addPage(doc, project, copy.gallery, copy);
    writeSectionTitle(doc, copy.gallery, doc.y, copy.rtl);
    imagePaths.slice(0, 4).forEach((image, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = 44 + col * 258;
      const yImage = 125 + row * 260;
      imageCover(doc, image.path, x, yImage, 247, 190);
      const imageCaption = language === 'en' ? cleanText(image.caption || copy.projectImage, 240) : copy.projectImage;
      doc.fillColor(MUTED).font('Brochure-Regular').fontSize(8).text(imageCaption, x, yImage + 198, { width: 247, height: 38, align: copy.rtl ? 'right' : 'left' });
    });
  }

  addPage(doc, project, agent ? `${copy.contact} - ${cleanText(agent.full_name, 60)}` : copy.contact, copy);
  const agentPhotoPath = localAssetPath(agent?.profile_photo_url || (cleanText(agent?.full_name).toLowerCase() === 'kazi honest' ? '/assets/agents/kazi-honest-professional-v2.jpg' : ''));
  if (agentPhotoPath) imageCover(doc, agentPhotoPath, 44, 108, 118, 118);
  else doc.circle(103, 167, 59).fill(PALE);
  doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(10).text(copy.contactLabel, 184, 116, { width: 365, align: copy.rtl ? 'right' : 'left' });
  doc.fillColor(INK).font('Brochure-Bold').fontSize(22).text(cleanText(agent?.full_name || project.source_display_name || copy.contact, 120), 184, 138, { width: 365, align: copy.rtl ? 'right' : 'left' });
  doc.fillColor(MUTED).font('Brochure-Regular').fontSize(10).text(cleanText(agent?.company_name || copy.brokerProfile, 140), 184, 172, { width: 365, align: copy.rtl ? 'right' : 'left' });
  const agentPhone = cleanText(agent?.whatsapp || agent?.phone, 60);
  if (agentPhone) doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(10).text(`${copy.phone}: ${agentPhone}`, 184, 190, { width: 365, link: `tel:${agentPhone.replace(/[^+\d]/g, '')}`, align: copy.rtl ? 'right' : 'left' });
  const agentBio = cleanText(agent?.full_name).toLowerCase() === 'kazi honest' && language !== 'en' ? copy.kaziBio : cleanText(agent?.bio, 520);
  if (agentBio) doc.fillColor(INK).font('Brochure-Regular').fontSize(9).text(agentBio, 184, agentPhone ? 211 : 196, { width: 365, height: agentPhone ? 38 : 53, ellipsis: true, lineGap: 3, align: copy.rtl ? 'right' : 'left' });
  doc.roundedRect(44, 250, 505, 46, 11).fill(BRAND_GREEN);
  doc.fillColor('#ffffff').font('Brochure-Bold').fontSize(12).text(copy.viewProfile, 62, 267, { width: 470, align: 'center', link: agent ? agentUrl(agent) : projectUrl(project) });
  doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(14).text(copy.moreProperties, 44, 326, { width: 505, align: copy.rtl ? 'right' : 'left' });
  const listingRows = (agent?.listings || []).slice(0, 5);
  let listingY = 354;
  listingRows.forEach((listing, index) => {
    const thumb = options.agentListingImageBuffers?.[index];
    if (thumb) imageCover(doc, thumb, 44, listingY, 76, 54);
    else doc.roundedRect(44, listingY, 76, 54, 7).fill(PALE);
    const listingTitle = language === 'en' ? cleanText(listing.title || copy.property, 120) : `${copy.property} - ${cleanText(listing.area || listing.district, 90)}`;
    doc.fillColor(INK).font('Brochure-Bold').fontSize(9.5).text(listingTitle, 132, listingY + 4, { width: 285, height: 24, ellipsis: true, align: copy.rtl ? 'right' : 'left' });
    doc.fillColor(MUTED).font('Brochure-Regular').fontSize(8.5).text([listing.area, listing.district].filter(Boolean).join(', ') || copy.profileLocation, 132, listingY + 31, { width: 205, align: copy.rtl ? 'right' : 'left' });
    doc.fillColor(BRAND_GREEN).font('Brochure-Bold').fontSize(8.5).text(formatMoney(listing.price, listing.price_currency || 'UGX', copy), 360, listingY + 20, { width: 185, align: 'right' });
    listingY += 66;
  });
  if (!listingRows.length) doc.fillColor(MUTED).font('Brochure-Regular').fontSize(10).text(copy.openProfile, 44, 362, { width: 505, align: copy.rtl ? 'right' : 'left' });
  doc.fillColor(INK).font('Brochure-Bold').fontSize(11).text(copy.important, 44, 700, { width: 505, align: copy.rtl ? 'right' : 'left' });
  doc.fillColor(MUTED).font('Brochure-Regular').fontSize(8).text(copy.disclaimer, 44, 718, { width: 505, lineGap: 3, align: copy.rtl ? 'right' : 'left' });

  doc.end();
  return doc;
}

async function brochureBuffer(project, options = {}) {
  const agentProfile = options.agentProfile || null;
  const [mapImageBuffer, ...agentListingImageBuffers] = await Promise.all([
    options.mapImageBuffer || googleStaticMapBuffer(project),
    ...(agentProfile?.listings || []).slice(0, 5).map((listing) => safeRemoteImageBuffer(listing.primary_image_url))
  ]);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = buildOffPlanBrochure(project, null, { ...options, agentProfile, mapImageBuffer, agentListingImageBuffers });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = {
  brochureBuffer,
  buildOffPlanBrochure,
  computeMortgageEstimate,
  distanceFromProject,
  distanceKmBetween,
  formatApproximateDistance,
  formatDate,
  formatMoney,
  googleMapsUrl,
  localAssetPath,
  projectUrl
};
