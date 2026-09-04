'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { normalizeDevelopmentRow } = require('./offPlanService');

const BRAND_GREEN = '#117a3d';
const BRAND_GOLD = '#e9a321';
const INK = '#182230';
const MUTED = '#667085';
const PALE = '#f4f8f3';

function cleanText(value, max = 4000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function formatMoney(value, currency = 'UGX') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Price on request';
  return `${cleanText(currency, 3).toUpperCase()} ${Math.round(amount).toLocaleString('en-UG')}`;
}

function formatDate(value) {
  if (!value) return 'To verify';
  const dateOnlyMatch = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/) : null;
  const date = value instanceof Date
    ? new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), 12))
    : dateOnlyMatch
      ? new Date(Date.UTC(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]), 12))
      : new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, 80);
  return new Intl.DateTimeFormat('en-UG', {
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
  if (/school|child|nursery|kindergarten/.test(source)) return 'Schools and childcare';
  if (/hospital|clinic|health|medical/.test(source)) return 'Healthcare';
  if (/university|college|tertiary/.test(source)) return 'Universities';
  if (/market|shop|mall|supermarket|retail/.test(source)) return 'Markets and shopping';
  if (/airport|transport|bus|ferry/.test(source)) return 'Transport';
  return 'Parks and family activities';
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

function formatApproximateDistance(project, place) {
  const distance = distanceFromProject(project, place);
  if (!Number.isFinite(distance)) return 'Distance to verify';
  const display = distance < 0.1 ? '<0.1' : distance.toFixed(distance < 10 ? 1 : 0);
  return `Approx. ${display} km from displayed area point`;
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

function addHeader(doc, title = '') {
  const previousY = doc.y;
  doc.save();
  doc.rect(0, 0, doc.page.width, 64).fill(BRAND_GREEN);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(21).text('makaug', 44, 20, { continued: true, lineBreak: false });
  doc.fillColor(BRAND_GOLD).text('.com', { lineBreak: false });
  if (title) doc.fillColor('#d9efe0').font('Helvetica').fontSize(9).text(cleanText(title, 70), 300, 27, { width: 250, align: 'right', lineBreak: false });
  doc.restore();
  doc.y = previousY;
}

function addFooter(doc, project) {
  const y = doc.page.height - 44;
  const previousY = doc.y;
  const previousBottomMargin = doc.page.margins.bottom;
  doc.save();
  // PDFKit automatically creates a new page when text enters the bottom margin.
  // The footer deliberately occupies that margin, so suspend it while drawing.
  doc.page.margins.bottom = 0;
  doc.moveTo(42, y - 10).lineTo(doc.page.width - 42, y - 10).strokeColor('#d9e2dc').stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text('Information is subject to staff verification and may change.', 42, y, { width: 300, height: 12, lineBreak: false })
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

function addPage(doc, project, title) {
  doc.addPage();
  addHeader(doc, title);
  addFooter(doc, project);
  doc.y = 88;
}

function writeSectionTitle(doc, title, y = doc.y) {
  doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(18).text(title, 44, y);
  doc.moveDown(0.5);
}

function progressBar(doc, label, value, x, y, width) {
  const known = value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const progress = known ? Math.max(0, Math.min(100, Number(value))) : 0;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(label, x, y, { width: width - 50 });
  doc.fillColor(MUTED).font('Helvetica').text(known ? `${progress}%` : 'To verify', x + width - 70, y, { width: 70, align: 'right' });
  doc.roundedRect(x, y + 20, width, 9, 4).fill('#e4ebe6');
  if (known && progress > 0) doc.roundedRect(x, y + 20, width * progress / 100, 9, 4).fill(BRAND_GREEN);
}

function safeDescription(project) {
  const description = cleanText(project.description, 7000);
  return description || 'Project information is being prepared and verified by the makaug team.';
}

function buildOffPlanBrochure(projectInput, output, options = {}) {
  const project = normalizeDevelopmentRow(projectInput);
  const agent = options.agentProfile || null;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 88, right: 44, bottom: 64, left: 44 }, info: { Title: `${project.name} - makaug.com Off Plan`, Author: 'makaug.com', Subject: 'Off-plan project brochure' } });
  if (output && typeof output.write === 'function') doc.pipe(output);

  const imagePaths = project.images.map((image) => ({ ...image, path: localAssetPath(image.url) })).filter((image) => image.path);
  addHeader(doc, 'Off Plan Project');
  addFooter(doc, project);
  if (imagePaths[0]) imageCover(doc, imagePaths[0].path, 42, 90, doc.page.width - 84, 310);
  else doc.roundedRect(42, 90, doc.page.width - 84, 310, 16).fill(PALE);
  doc.fillColor(BRAND_GOLD).font('Helvetica-Bold').fontSize(10).text('OFF PLAN PROJECT', 44, 426);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(29).text(cleanText(project.name, 220), 44, 448, { width: 510 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(13).text([project.area, project.district].filter(Boolean).join(', '), 44, doc.y + 8);
  const price = project.launch_price_ugx != null
    ? `From ${formatMoney(project.launch_price_ugx, 'UGX')}`
    : 'UGX pricing to be verified';
  doc.roundedRect(44, doc.y + 24, 505, 72, 12).fill(PALE);
  doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(19).text(price, 62, doc.y + 48, { width: 470 });

  addPage(doc, project, 'Project overview');
  writeSectionTitle(doc, 'Project overview');
  doc.fillColor(INK).font('Helvetica').fontSize(11).text(safeDescription(project), { width: 505, lineGap: 4 });
  let y = Math.max(doc.y + 28, 270);
  progressBar(doc, 'Construction completed', project.construction_progress, 44, y, 235);
  progressBar(doc, 'Homes sold', project.sales_progress, 314, y, 235);
  y += 76;
  const facts = [
    ['Developer', project.developer_name || 'To verify'],
    ['Expected completion', formatDate(project.completion_date)],
    ['Total homes', project.units_total == null ? 'To verify' : String(project.units_total)],
    ['Homes available', project.units_available == null ? 'To verify' : String(project.units_available)],
    ['Payment period', project.payment_plan_months ? `${project.payment_plan_months} months` : 'To verify'],
    ['Source', project.source_display_name || 'makaug partner']
  ];
  facts.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 44 + col * 270;
    const top = y + row * 70;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), x, top, { width: 235 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(cleanText(value, 220), x, top + 17, { width: 235 });
  });

  addPage(doc, project, 'Location and area');
  writeSectionTitle(doc, 'Location and area');
  const areaOverview = cleanText(project.extra_fields?.area_overview, 1800)
    || `${[project.area, project.district].filter(Boolean).join(', ')}. Confirm the exact project pin, travel times and nearby services with the project contact.`;
  doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(areaOverview, 44, doc.y + 5, { width: 505, lineGap: 4 });
  const mapTop = Math.min(doc.y + 18, 235);
  if (options.mapImageBuffer) imageCover(doc, options.mapImageBuffer, 44, mapTop, 505, 235);
  else {
    doc.roundedRect(44, mapTop, 505, 235, 14).fill('#e9f1ec');
    doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(18).text('Open this area in Google Maps', 74, mapTop + 84, { width: 445, align: 'center', link: googleMapsUrl(project) });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('A static map was unavailable while this brochure was generated.', 74, mapTop + 120, { width: 445, align: 'center' });
  }
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(project.extra_fields?.map_precision === 'area_centroid'
    ? 'The red marker represents the wider Entebbe area. The exact development pin is still being confirmed.'
    : 'Confirm the exact entrance and travel times before making a commitment.', 44, mapTop + 246, { width: 505, link: googleMapsUrl(project) });
  doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(11).text('Open this area in Google Maps', 44, mapTop + 274, { width: 505, link: googleMapsUrl(project), underline: true });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text('Family services and source-attributed area references continue on the next page. Confirm every route and travel time from the exact development entrance.', 44, mapTop + 298, { width: 505, lineGap: 3 });

  addPage(doc, project, 'Family life and local services');
  writeSectionTitle(doc, 'Family life and local services');
  doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text('Explore education, healthcare, shopping, recreation and transport in the wider Entebbe area. Distances are approximate straight-line measurements from the displayed area point, not driving distances from a verified entrance. Confirm routes and current services directly.', 44, doc.y + 5, { width: 505, lineGap: 3 });
  const groupedPlaces = new Map();
  project.nearby_places.forEach((place) => {
    const key = areaGroup(place);
    if (!groupedPlaces.has(key)) groupedPlaces.set(key, []);
    groupedPlaces.get(key).push(place);
  });
  const servicesYByColumn = [doc.y + 32, doc.y + 32];
  const groupOrder = ['Schools and childcare', 'Healthcare', 'Universities', 'Markets and shopping', 'Parks and family activities', 'Transport'];
  groupOrder.filter((groupName) => (groupedPlaces.get(groupName) || []).length).forEach((groupName, groupIndex) => {
    const places = (groupedPlaces.get(groupName) || []).slice(0, 3);
    const column = groupIndex % 2;
    const x = 44 + column * 258;
    const width = 247;
    let servicesY = servicesYByColumn[column];
    if (servicesY > 690) return;
    doc.roundedRect(x, servicesY, width, 28, 8).fill('#e5f2e9');
    doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(10.5).text(groupName, x + 12, servicesY + 8, { width: width - 24, height: 14, ellipsis: true });
    servicesY += 35;
    places.forEach((place) => {
      if (servicesY > 718) return;
      doc.roundedRect(x, servicesY, width, 58, 8).fill(PALE);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text(cleanText(place.name || groupName, 150), x + 11, servicesY + 7, { width: width - 22, height: 13, ellipsis: true });
      doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(7.3).text(formatApproximateDistance(project, place), x + 11, servicesY + 23, { width: width - 22, height: 11, ellipsis: true });
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(cleanText(place.note || 'Confirm current details and travel time.', 220), x + 11, servicesY + 37, { width: width - 22, height: 15, ellipsis: true, lineGap: 1, link: place.source_url || undefined });
      servicesY += 64;
    });
    servicesYByColumn[column] = servicesY + 12;
  });

  addPage(doc, project, 'Homes and payment plan');
  writeSectionTitle(doc, 'Available home types');
  let tableY = doc.y + 8;
  if (!project.unit_types.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(11).text('Unit information is being verified.', 44, tableY);
    tableY += 40;
  } else {
    project.unit_types.forEach((unit, index) => {
      const yRow = tableY + index * 58;
      if (yRow > 530) return;
      doc.roundedRect(44, yRow, 505, 46, 8).fill(index % 2 ? '#ffffff' : PALE);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(cleanText(unit.label || `${unit.bedrooms || ''} Bedroom ${unit.property_type || 'home'}`), 58, yRow + 9, { width: 280 });
      const priceText = unit.price_ugx
        ? `${formatMoney(unit.price_ugx, 'UGX')}${unit.price_original ? ` guide | Source ${formatMoney(unit.price_original, unit.price_original_currency || project.original_currency)}` : ''}`
        : unit.price_original
          ? `${formatMoney(unit.price_original, unit.price_original_currency || project.original_currency)} supplied - UGX to verify`
          : 'Price on request';
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(priceText, 58, yRow + 25, { width: 450 });
    });
    tableY += Math.min(project.unit_types.length, 6) * 58 + 18;
  }
  writeSectionTitle(doc, 'Payment plan', Math.min(tableY, 545));
  const paymentLines = project.payment_plan.length
    ? project.payment_plan.map((item) => `${cleanText(item.label || 'Milestone')}: ${item.amount_original ? formatMoney(item.amount_original, item.currency || project.original_currency) : item.kind === 'equal_monthly' ? `equal instalments over ${item.months || project.payment_plan_months || '?'} months` : cleanText(item.due || 'To verify')}`)
    : ['Payment milestones are being verified.'];
  doc.fillColor(INK).font('Helvetica').fontSize(10).list(paymentLines, 60, doc.y + 8, { width: 475, bulletRadius: 2, textIndent: 12, lineGap: 5 });
  doc.moveDown(1.2);
  const paymentNote = cleanText(project.extra_fields?.payment_terms_note, 900)
    || 'Use the interactive payment calculator on makaug.com for a personalised illustrative schedule. Confirm all terms with the developer before paying.';
  doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9).text(paymentNote, 44, doc.y, { width: 505, lineGap: 3 });

  addPage(doc, project, 'Mortgage comparison');
  writeSectionTitle(doc, 'Potential mortgage providers');
  const mortgagePrice = Number(project.launch_price_ugx);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(`These illustrations use ${Number.isFinite(mortgagePrice) ? formatMoney(mortgagePrice, 'UGX') : 'the project launch price'}, each lender's published minimum deposit and a term of up to 20 years. They are not approvals or guaranteed offers. Confirm whether the lender will finance this off-plan project.`, 44, doc.y + 5, { width: 505, lineGap: 3 });
  const mortgageProviders = (options.mortgageProviders || []).slice(0, 3);
  let mortgageY = doc.y + 30;
  (mortgageProviders.length ? mortgageProviders : [{ name: 'Mortgage provider information', sourceNote: 'Open the live mortgage comparison on makaug.com for the latest available public lender information.' }]).forEach((provider) => {
    const rate = Number(provider.residentialRate);
    const deposit = Number(provider.minDepositPct?.residential);
    const maximumYears = Number(provider.maxYears?.residential);
    const years = Number.isFinite(maximumYears) ? Math.min(20, maximumYears) : 20;
    const principal = Number.isFinite(mortgagePrice) && Number.isFinite(deposit) ? mortgagePrice * (1 - deposit / 100) : mortgagePrice;
    const estimate = computeMortgageEstimate({ principal, annualRate: rate, years, arrangementFeePct: provider.arrangementFeePct });
    doc.roundedRect(44, mortgageY, 505, 166, 12).fill(PALE);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(cleanText(provider.name || 'Mortgage provider', 120), 62, mortgageY + 13, { width: 460 });
    doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(8.5).text(`RATE: ${Number.isFinite(rate) ? `${rate}%` : 'QUOTE REQUIRED'}   |   MINIMUM DEPOSIT: ${Number.isFinite(deposit) ? `${deposit}%` : 'CONFIRM'}   |   TERM USED: ${years} YEARS`, 62, mortgageY + 36, { width: 460 });
    if (estimate) {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(`Loan amount: ${formatMoney(estimate.principal, 'UGX')}`, 62, mortgageY + 57, { width: 225 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(`Estimated monthly: ${formatMoney(estimate.monthly, 'UGX')}`, 300, mortgageY + 57, { width: 235, align: 'right' });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`Estimated interest: ${formatMoney(estimate.interest, 'UGX')}`, 62, mortgageY + 79, { width: 225 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`Arrangement fee: ${formatMoney(estimate.arrangementFee, 'UGX')}`, 300, mortgageY + 79, { width: 235, align: 'right' });
      doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(9).text(`Estimated total repayment: ${formatMoney(estimate.total, 'UGX')}`, 62, mortgageY + 100, { width: 473 });
    }
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(cleanText(provider.sourceNote || 'Confirm eligibility, valuation, fees, rate and approval with the lender.', 420), 62, mortgageY + 121, { width: 460, height: 28, ellipsis: true, lineGap: 2, link: provider.sourceUrl || undefined });
    mortgageY += 178;
  });
  doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5).text('Reducing-balance illustrations only. Mortgage rates, fees, loan-to-value limits, eligibility and terms can change. Confirm a current lender quote, all taxes and other charges. This comparison does not replace an offer letter or independent financial advice.', 44, 696, { width: 505, lineGap: 3 });

  if (imagePaths.length) {
    addPage(doc, project, 'Project gallery');
    writeSectionTitle(doc, 'Project gallery');
    imagePaths.slice(0, 4).forEach((image, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = 44 + col * 258;
      const yImage = 125 + row * 260;
      imageCover(doc, image.path, x, yImage, 247, 190);
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(cleanText(image.caption || 'Project image', 240), x, yImage + 198, { width: 247, height: 38 });
    });
  }

  addPage(doc, project, agent ? `Project contact - ${cleanText(agent.full_name, 60)}` : 'Project contact');
  const agentPhotoPath = localAssetPath(agent?.profile_photo_url || (cleanText(agent?.full_name).toLowerCase() === 'kazi honest' ? '/assets/agents/kazi-honest-professional-v2.jpg' : ''));
  if (agentPhotoPath) imageCover(doc, agentPhotoPath, 44, 108, 118, 118);
  else doc.circle(103, 167, 59).fill(PALE);
  doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(10).text('PROJECT CONTACT', 184, 116);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(cleanText(agent?.full_name || project.source_display_name || 'Project team', 120), 184, 138, { width: 365 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(cleanText(agent?.company_name || 'makaug broker profile', 140), 184, 172, { width: 365 });
  const agentPhone = cleanText(agent?.whatsapp || agent?.phone, 60);
  if (agentPhone) doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(10).text(`Phone / WhatsApp: ${agentPhone}`, 184, 190, { width: 365, link: `tel:${agentPhone.replace(/[^+\d]/g, '')}` });
  if (agent?.bio) doc.fillColor(INK).font('Helvetica').fontSize(9).text(cleanText(agent.bio, 520), 184, agentPhone ? 211 : 196, { width: 365, height: agentPhone ? 38 : 53, ellipsis: true, lineGap: 3 });
  doc.roundedRect(44, 250, 505, 46, 11).fill(BRAND_GREEN);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12).text('View the broker profile and all current properties on makaug.com', 62, 267, { width: 470, align: 'center', link: agent ? agentUrl(agent) : projectUrl(project) });
  doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(14).text('More properties from this contact', 44, 326);
  const listingRows = (agent?.listings || []).slice(0, 5);
  let listingY = 354;
  listingRows.forEach((listing, index) => {
    const thumb = options.agentListingImageBuffers?.[index];
    if (thumb) imageCover(doc, thumb, 44, listingY, 76, 54);
    else doc.roundedRect(44, listingY, 76, 54, 7).fill(PALE);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(cleanText(listing.title || 'Property', 120), 132, listingY + 4, { width: 285, height: 24, ellipsis: true });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text([listing.area, listing.district].filter(Boolean).join(', ') || 'Location on profile', 132, listingY + 31, { width: 205 });
    doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(8.5).text(formatMoney(listing.price, listing.price_currency || 'UGX'), 360, listingY + 20, { width: 185, align: 'right' });
    listingY += 66;
  });
  if (!listingRows.length) doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Open the broker profile for current listings and availability.', 44, 362, { width: 505 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Important', 44, 700);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Off-plan prices, availability, construction progress, completion dates, specifications, mortgage terms, illustrations and payment plans may change. Confirm the developer, approvals, title, signed contract and payment destination with the project contact, and obtain independent legal and financial advice before committing funds.', 44, 718, { width: 505, lineGap: 3 });

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
