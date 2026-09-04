'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { brochureBuffer, formatDate } = require('../services/offPlanBrochureService');

test('brochure renders a seven-page A4 PDF with area, mortgage and broker sections without pagination overflow', async () => {
  const pdf = await brochureBuffer({
    name: 'Verified QA Project',
    slug: 'verified-qa-project',
    description: 'A verified local quality assurance description used to exercise the complete brochure layout without publishing a real project.',
    area: 'Entebbe',
    district: 'Wakiso',
    developer_name: 'QA Developer',
    completion_date: '2028-12-01',
    construction_progress: 35,
    sales_progress: 30,
    units_total: 60,
    units_sold: 18,
    units_available: 42,
    payment_plan_months: 15,
    verification_status: 'verified',
    unit_types: [{ label: '2 Bedroom townhouse', bedrooms: 2, price_ugx: 410000000 }],
    payment_plan: [{ label: 'Buyer contribution', kind: 'percentage', percent: 15 }],
    images: [{
      url: '/assets/off-plan/entebbe-victoria-palms/construction-interior-1.jpg',
      caption: 'Construction progress photo supplied to makaug'
    }]
  });

  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.3');
  assert.ok(pdf.length > 20_000);
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 7);
});

test('brochure dates are human-readable in Uganda time', () => {
  assert.equal(formatDate('2028-12-01'), '1 December 2028');
  assert.equal(formatDate(new Date(2028, 11, 1)), '1 December 2028');
  assert.equal(formatDate(null), 'To verify');
});
