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

function localAssetPath(url) {
  const clean = cleanText(url, 2000).split('?')[0];
  if (!clean.startsWith('/assets/')) return null;
  const relative = clean.replace(/^\/+/, '');
  const candidate = path.resolve(__dirname, '..', relative);
  const assetsRoot = path.resolve(__dirname, '..', 'assets');
  if (!candidate.startsWith(`${assetsRoot}${path.sep}`) || !fs.existsSync(candidate)) return null;
  return candidate;
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
  const known = Number.isFinite(Number(value));
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

function buildOffPlanBrochure(projectInput, output) {
  const project = normalizeDevelopmentRow(projectInput);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 88, right: 44, bottom: 64, left: 44 }, info: { Title: `${project.name} - makaug.com Off Plan`, Author: 'makaug.com', Subject: 'Off-plan project brochure' } });
  if (output && typeof output.write === 'function') doc.pipe(output);

  const imagePaths = project.images.map((image) => ({ ...image, path: localAssetPath(image.url) })).filter((image) => image.path);
  addHeader(doc, 'Off Plan Uganda');
  addFooter(doc, project);
  if (imagePaths[0]) imageCover(doc, imagePaths[0].path, 42, 90, doc.page.width - 84, 310);
  else doc.roundedRect(42, 90, doc.page.width - 84, 310, 16).fill(PALE);
  doc.fillColor(BRAND_GOLD).font('Helvetica-Bold').fontSize(10).text('OFF PLAN PROJECT', 44, 426);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(29).text(cleanText(project.name, 220), 44, 448, { width: 510 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(13).text([project.area, project.district, 'Uganda'].filter(Boolean).join(', '), 44, doc.y + 8);
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
        ? formatMoney(unit.price_ugx, 'UGX')
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
  doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9).text('Use the interactive payment calculator on makaug.com for a personalised illustrative schedule. Confirm all terms with the developer before paying.', 44, doc.y, { width: 505, lineGap: 3 });

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

  addPage(doc, project, 'Enquire with makaug');
  doc.fillColor(BRAND_GREEN).font('Helvetica-Bold').fontSize(25).text('Interested in this project?', 44, 130, { width: 505, align: 'center' });
  doc.fillColor(INK).font('Helvetica').fontSize(12).text('Open the verified project page for current availability, maps, payment options and direct help from the makaug team.', 78, 190, { width: 437, align: 'center', lineGap: 5 });
  doc.roundedRect(110, 282, 375, 64, 14).fill(BRAND_GREEN);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14).text('View this project on makaug.com', 130, 305, { width: 335, align: 'center', link: projectUrl(project) });
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(projectUrl(project), 78, 382, { width: 437, align: 'center', link: projectUrl(project) });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Important', 44, 475);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Off-plan purchases involve risk. Prices, availability, construction progress, completion dates, specifications, illustrations and payment terms may change. Verify the developer, approvals, title, contract and payment destination, and obtain independent legal and financial advice before committing funds.', 44, 500, { width: 505, lineGap: 4 });

  doc.end();
  return doc;
}

function brochureBuffer(project) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = buildOffPlanBrochure(project);
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = {
  brochureBuffer,
  buildOffPlanBrochure,
  formatDate,
  formatMoney,
  localAssetPath,
  projectUrl
};
