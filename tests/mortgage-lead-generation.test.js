const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const mortgageRoutes = fs.readFileSync(path.join(root, 'routes', 'mortgage.js'), 'utf8');

const requiredWindowHandlers = [
  'loadMortgageRates',
  'renderMortgageFinder',
  'requestMortgageHelp',
  'resetMortgageCalculator',
  'saveMortgageCalculation',
  'setMortgageExtraPayment',
  'setMortgageLeadProvider',
  'setMortgageManualRate',
  'setMortgageTab',
  'submitMortgageLead',
  'syncMortgageInput',
  'syncMortgageSlider'
];

assert(
  html.includes('mortgage-finder-accuracy-handlers-20260621'),
  'mortgage cache marker should force the corrected app bundle to load'
);
assert(
  html.includes('id="mortgage-rate" type="number" value=""') && html.includes('oninput="setMortgageManualRate(this.value)"'),
  'mortgage rate field should start from the best provider rate and only switch to manual mode when edited'
);
assert(
  html.includes('id="mortgage-refresh-btn" type="button" onclick="loadMortgageRates(true)"'),
  'mortgage refresh control should be a safe button wired to rate refresh'
);
assert(
  html.includes('id="mortgage-lead-submit" type="button" onclick="submitMortgageLead()"'),
  'mortgage lead submit should be a safe button wired to lead capture'
);

assert(app.includes('function exposeMortgageFinderHandlers()'), 'mortgage browser handlers should be explicitly exposed');
assert(app.includes('Object.assign(window'), 'mortgage browser handlers should be attached to window');
for (const handler of requiredWindowHandlers) {
  assert(app.includes(handler), `missing exported mortgage handler: ${handler}`);
}

assert(app.includes('let mortgageRateManuallyEdited = false;'), 'mortgage manual rate state should exist');
assert(app.includes('function resolveMortgageSelectedRate'), 'mortgage rate resolver should exist');
assert(app.includes('function getMortgageFeeEstimates'), 'mortgage fee estimator should exist');
assert(app.includes('transferStampDuty = price * 0.015'), 'transfer stamp duty should use the verified 1.5% public assumption');
assert(app.includes('mortgageStampDuty = loanAmount * 0.005'), 'mortgage stamp duty should use the verified 0.5% public assumption');
assert(app.includes('valuationEstimate = price * 0.0025'), 'valuation estimate should use the verified 0.25% public assumption');
assert(app.includes('mergeAuditedMortgageProvider'), 'frontend should protect audited bank data from stale API rows');

assert(mortgageRoutes.includes('withAuditedMortgageData'), 'API should protect audited bank data from stale DB rows');
assert(mortgageRoutes.includes("residentialRate: null"), 'Housing Finance variable public rate should render as quote required');
assert(mortgageRoutes.includes("sourceVerifiedAt: '2026-06-21'"), 'audited mortgage assumptions should carry the verification date');
assert(mortgageRoutes.includes('sourceNote'), 'audited source notes should be returned to the UI');
assert(mortgageRoutes.includes('mortgage_bank_callback'), 'bank-specific mortgage callbacks should still create CRM leads');

console.log('mortgage-lead-generation regression checks passed');
