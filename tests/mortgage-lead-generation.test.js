const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const mortgageRoutes = fs.readFileSync(path.join(root, 'routes', 'mortgage.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

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
  html.includes('mortgage-finder-accuracy-handlers-20260621')
    && html.includes('mortgage-qualification-20260621-mortgage-provider-sources-20260621')
    && html.includes('mortgage-provider-badges-20260630'),
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
for (const id of [
  'mortgage-lead-stage',
  'mortgage-lead-deposit-status',
  'mortgage-lead-income-type',
  'mortgage-lead-monthly-income'
]) {
  assert(html.includes(`id="${id}"`), `mortgage lead form should include ${id}`);
}

assert(app.includes('function exposeMortgageFinderHandlers()'), 'mortgage browser handlers should be explicitly exposed');
assert(app.includes('Object.assign(window'), 'mortgage browser handlers should be attached to window');
for (const handler of requiredWindowHandlers) {
  assert(app.includes(handler), `missing exported mortgage handler: ${handler}`);
}

assert(app.includes('let mortgageRateManuallyEdited = false;'), 'mortgage manual rate state should exist');
assert(app.includes('function resolveMortgageSelectedRate'), 'mortgage rate resolver should exist');
assert(app.includes('function getMortgageFeeEstimates'), 'mortgage fee estimator should exist');
assert(server.includes("mortgageUiTabsBankLogosVersion = 'mortgage-provider-badges-20260630'"), 'server should append the mortgage UI cache marker in production HTML');
assert(app.includes('const MORTGAGE_PROVIDER_BRANDS'), 'mortgage comparison should define bank brand/logo metadata');
assert(app.includes('function renderMortgageProviderLogo'), 'mortgage comparison should render lender logo badges');
assert(app.includes('renderMortgageProviderLogo(result.best.provider'), 'best-match mortgage card should show a lender logo');
assert(app.includes('renderMortgageProviderLogo(row.provider'), 'every mortgage comparison row should show a lender logo');
assert(app.includes('data-mortgage-logo-text'), 'mortgage lender badges should render deterministic text labels immediately');
assert(!app.includes('/favicon.ico'), 'mortgage lender badges should not depend on third-party favicon URLs');
assert(html.includes('grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.82fr)]'), 'mortgage calculator should use the compact two-column layout');
assert(html.includes('bg-white/85 p-3 text-sm text-emerald-950 shadow-sm'), 'mortgage tab panel should live inside the calculator panel');
const mortgageResultShell = (html.match(/id="mortgage-professional-results"[^>]+>/) || [''])[0];
assert(!mortgageResultShell.includes('min-h-[360px]'), 'mortgage result card should not force a large blank area');
assert(app.includes('aria-pressed'), 'mortgage tabs should expose active state and visibly change content');
for (const provider of [
  'NCBA Bank Uganda',
  'Centenary Bank Uganda',
  'https://ncbagroup.com/ug/property-loans/',
  'https://www.centenarybank.co.ug/product/cente-mortgage/4/8'
]) {
  assert(app.includes(provider), `frontend audited mortgage providers should include ${provider}`);
  assert(mortgageRoutes.includes(provider), `API audited mortgage providers should include ${provider}`);
}
assert(app.includes('leadQualificationTitle'), 'mortgage lead form should explain optional qualifying questions');
for (const snippet of [
  'leadQualificationTitle: "Ebibuuzo',
  'leadQualificationTitle: "Maswali',
  'leadQualificationTitle: "Ibibazo',
  'leadQualificationTitle: "አጭር',
  'leadQualificationTitle: "أسئلة'
]) {
  assert(app.includes(snippet), `mortgage qualifying questions should be localized: ${snippet}`);
}
assert(app.includes('buying_stage: buyingStage || null'), 'mortgage lead payload should include buying stage');
assert(app.includes('deposit_status: depositStatus || null'), 'mortgage lead payload should include deposit readiness');
assert(app.includes('income_type: incomeType || null'), 'mortgage lead payload should include income type');
assert(app.includes('transferStampDuty = price * 0.015'), 'transfer stamp duty should use the verified 1.5% public assumption');
assert(app.includes('mortgageStampDuty = loanAmount * 0.005'), 'mortgage stamp duty should use the verified 0.5% public assumption');
assert(app.includes('valuationEstimate = price * 0.0025'), 'valuation estimate should use the verified 0.25% public assumption');
for (const lang of ['lg', 'sw', 'ac', 'ny', 'sm', 'am', 'ar']) {
  const marker = `Object.assign(MORTGAGE_I18N.${lang}`;
  const chunk = app.slice(app.indexOf(marker), app.indexOf(marker) + 2400);
  assert(chunk.includes('mortgageStampDutyEstimate:'), `missing mortgage stamp-duty label for ${lang}`);
  assert(chunk.includes('valuationEstimate:'), `missing mortgage valuation label for ${lang}`);
  assert(chunk.includes('transferAndStampDutyEstimate:'), `missing mortgage transfer/stamp/valuation label for ${lang}`);
  assert(chunk.includes('bestRateApplied:'), `missing best-rate source line for ${lang}`);
  assert(chunk.includes('manualRateApplied:'), `missing manual-rate source line for ${lang}`);
}
assert(app.includes('mergeAuditedMortgageProvider'), 'frontend should protect audited bank data from stale API rows');
assert(app.includes('mergeAuditedMortgageProviderList'), 'frontend should append audited providers missing from API rows');
assert(app.includes('DEFAULT_MORTGAGE_PROVIDERS'), 'frontend should keep audited fallback providers available after API hydration');

assert(mortgageRoutes.includes('withAuditedMortgageData'), 'API should protect audited bank data from stale DB rows');
assert(mortgageRoutes.includes('mergeAuditedMortgageProviders'), 'API should append audited providers missing from database rows');
assert(mortgageRoutes.includes('seenProviderKeys.has(provider.key)'), 'API should avoid duplicated audited providers when merging database rows');
assert(mortgageRoutes.includes('} catch (error) {'), 'API should fall back to audited public provider data when database reads fail');
assert(mortgageRoutes.includes("residentialRate: null"), 'Housing Finance variable public rate should render as quote required');
assert(mortgageRoutes.includes("sourceVerifiedAt: '2026-06-21'"), 'audited mortgage assumptions should carry the verification date');
assert(mortgageRoutes.includes('sourceNote'), 'audited source notes should be returned to the UI');
assert(mortgageRoutes.includes('mortgage_bank_callback'), 'bank-specific mortgage callbacks should still create CRM leads');
assert(mortgageRoutes.includes('buyingStage'), 'mortgage enquiry API should persist buying stage');
assert(mortgageRoutes.includes('depositStatus'), 'mortgage enquiry API should persist deposit readiness');
assert(mortgageRoutes.includes('incomeType'), 'mortgage enquiry API should persist income type');

console.log('mortgage-lead-generation regression checks passed');
