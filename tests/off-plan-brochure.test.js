'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { brochureBuffer, computeMortgageEstimate, distanceKmBetween, formatApproximateDistance, formatDate } = require('../services/offPlanBrochureService');

test('brochure renders an eight-page A4 PDF with map, family services, mortgage and broker sections without pagination overflow', async () => {
  const pdf = await brochureBuffer({
    name: 'Verified QA Project',
    slug: 'verified-qa-project',
    description: 'A verified local quality assurance description used to exercise the complete brochure layout without publishing a real project.',
    area: 'Entebbe',
    district: 'Wakiso',
    latitude: 0.0512,
    longitude: 32.4637,
    launch_price_ugx: 410000000,
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
    nearby_places: [
      { category: 'Healthcare', name: 'QA Hospital', note: 'Confirm current services.', source_url: 'https://example.com/hospital', latitude: 0.063874, longitude: 32.471655 },
      { category: 'University', name: 'QA University', note: 'Confirm the current campus.', source_url: 'https://example.com/university', latitude: 0.095, longitude: 32.5075 },
      { category: 'Shopping', name: 'QA Market', note: 'Confirm opening times.', source_url: 'https://example.com/market', latitude: 0.066486, longitude: 32.47634 }
    ],
    images: [{
      url: '/assets/off-plan/entebbe-victoria-palms/construction-interior-1.jpg',
      caption: 'Construction progress photo supplied to makaug'
    }]
  }, { agentProfile: { id: 'agent-qa', full_name: 'Kazi Honest', whatsapp: '+256791218405', bio: 'Project contact for quality assurance.' }, mortgageProviders: [{ name: 'QA Bank', residentialRate: 16.5, minDepositPct: { residential: 20 }, maxYears: { residential: 25 }, arrangementFeePct: 1.5 }] });

  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.3');
  assert.ok(pdf.length > 20_000);
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 8);
});

test('nearby distance uses a straight-line project-to-place calculation and labels it as approximate', () => {
  const project = { latitude: 0.0512, longitude: 32.4637 };
  const hospital = { latitude: 0.063874, longitude: 32.471655 };
  const distance = distanceKmBetween(project, hospital);
  assert.ok(distance > 1.5 && distance < 1.8);
  assert.match(formatApproximateDistance(project, hospital), /^Approx\. 1\.\d km from displayed area point$/);
  assert.equal(formatApproximateDistance(project, project), 'Approx. <0.1 km from displayed area point');
});

test('mortgage estimate calculates reducing-balance monthly, interest, fee and total repayment', () => {
  const estimate = computeMortgageEstimate({ principal: 328000000, annualRate: 16.5, years: 20, arrangementFeePct: 1.5 });
  assert.ok(estimate.monthly > 4_000_000 && estimate.monthly < 5_000_000);
  assert.equal(estimate.arrangementFee, 4_920_000);
  assert.ok(estimate.interest > estimate.principal);
  assert.equal(Math.round(estimate.total), Math.round(estimate.principal + estimate.interest + estimate.arrangementFee));
});

test('brochure dates are human-readable in Uganda time', () => {
  assert.equal(formatDate('2028-12-01'), '1 December 2028');
  assert.equal(formatDate(new Date(2028, 11, 1)), '1 December 2028');
  assert.equal(formatDate(null), 'To verify');
});
