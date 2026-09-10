'use strict';

const PDFDocument = require('pdfkit');
const catalog = require('../config/aboutCommercialProducts');
const { formatUgxPrice } = require('./aboutCommercialProductsService');

const BRAND = '#15603f';
const INK = '#16241d';
const MUTED = '#5b6b62';
const RULE = '#dfe9e3';
const PALE = '#f1f7f3';

function buildAboutCommercialRateCardPdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, info: { Title: 'makaug commercial rate card', Author: 'makaug.com', Subject: 'Products and advertising rates' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12).text('makaug.com');
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(29).text('Commercial products & rate card', { lineGap: 2 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(11).text('Uganda property listings, visibility products, business services and advertising. Prices in UGX.', { lineGap: 3 });
    doc.moveDown(1.2);

    const productRows = [
      ['Private listing', 'privateListing', 'First 7 days free'],
      ['Agent subscription', 'agentSubscription', 'Multiple listings'],
      ['Off-plan development', 'offPlanDevelopment', 'Dedicated project page'],
      ['Featured listing', 'featuredListing', 'Homepage and category visibility'],
      ['Premium listing', 'premiumListing', 'Prime search position'],
      ['Boosted listing', 'boostedListing', 'Above standard results and alerts'],
      ['Market Intelligence Report', 'marketReport', 'PDF within 5 working days'],
      ['Agency website — setup', 'agencyWebsiteSetup', 'Branded, connected site'],
      ['Agency website — monthly', 'agencyWebsiteMonthly', 'Hosting, updates and support'],
      ['Professional listing service', 'professionalListing', 'Kampala and Wakiso']
    ];

    const ensure = (height) => { if (doc.y + height > doc.page.height - 54) doc.addPage(); };
    const section = (title) => { ensure(42); doc.moveDown(.4).fillColor(INK).font('Helvetica-Bold').fontSize(17).text(title); doc.moveDown(.5); };
    const row = (columns, widths, header = false) => {
      const height = header ? 27 : 35;
      ensure(height + 2);
      const x = doc.page.margins.left;
      const y = doc.y;
      doc.save().fillColor(header ? PALE : '#ffffff').rect(x, doc.y, pageWidth, height).fill().restore();
      doc.save().strokeColor(RULE).lineWidth(.6).rect(x, doc.y, pageWidth, height).stroke().restore();
      let cursor = x;
      columns.forEach((value, index) => {
        doc.fillColor(header ? INK : (index === columns.length - 1 ? BRAND : MUTED))
          .font(header || index === columns.length - 1 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(header ? 8.5 : 8.2)
          .text(String(value), cursor + 7, y + 8, { width: widths[index] - 14, height: height - 10, ellipsis: true });
        cursor += widths[index];
      });
      doc.y = y + height;
    };

    section('Products');
    row(['Product', 'Price', 'Best for'], [182, 160, pageWidth - 342], true);
    productRows.forEach(([name, key, note]) => {
      const item = catalog.products[key];
      row([name, `${formatUgxPrice(item.amount)} / ${item.period}`, note], [182, 160, pageWidth - 342]);
    });

    doc.addPage();
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12).text('makaug.com');
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(23).text('Advertising placements');
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Sold in 7-day blocks. Monthly bookings (4 weeks) receive 10% off. One advertiser per slot per week.');
    doc.moveDown(.8);
    row(['Page', 'Placement / format', 'UGX / week'], [115, pageWidth - 230, 115], true);
    catalog.advertisingPlacements.forEach((item, index) => {
      if (index === 18) {
        doc.addPage();
        doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12).text('makaug.com');
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('Advertising placements — continued');
        doc.moveDown(.6);
        row(['Page', 'Placement / format', 'UGX / week'], [115, pageWidth - 230, 115], true);
      }
      row([item.page, `${item.placement}\n${item.format}`, formatUgxPrice(item.amount)], [115, pageWidth - 230, 115]);
    });

    ensure(72);
    doc.moveDown(.8).fillColor(PALE).roundedRect(doc.page.margins.left, doc.y, pageWidth, 58, 8).fill();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Book or ask a question', doc.page.margins.left + 12, doc.y + 12);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('WhatsApp 0760 112 587 · info@makaug.com · makaug.com/advertise', { lineGap: 2 });
    doc.moveDown(2.4).fontSize(8).text('Rate guide dated 10 September 2026. Items marked for commercial confirmation in the source brief remain subject to written quotation. VAT treatment should be confirmed before invoicing.');
    doc.end();
  });
}

module.exports = { buildAboutCommercialRateCardPdf };
