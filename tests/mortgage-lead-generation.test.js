'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const indexHtml = read('index.html');
const appSource = read('assets/makaug-app.js');
const mortgageRoutes = read('routes/mortgage.js');
const adminRoutes = read('routes/admin.js');
const propertySeekerRoutes = read('routes/property-seeker.js');
const migration = read('db/migrations/060_saved_mortgage_calculations.sql');

for (const expected of [
  'setMortgageTab',
  'setMortgageExtraPayment',
  'setMortgageManualRate',
  'setMortgageComparisonSort',
  'requestMortgageHelp',
  'saveMortgageCalculation',
  'exposeMortgageFinderHandlers',
  'transferAndStampDutyEstimate',
  'mortgageStampDutyEstimate',
  'valuationEstimate',
  'mortgage-tab-panel',
  'MORTGAGE_PROVIDER_BRANDS',
  'renderMortgageProviderLogo',
  'aria-pressed',
  'grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.82fr)]',
  'mortgage-lead-provider',
  'providerContextSelected',
  'leadSubmitBank',
  'publicRecordDisclosure',
  'MORTGAGE_PROVIDER_LOGO_URLS',
  'activeMortgageComparisonSort',
  'ratesAsOfLine',
  'comparisonSubtitle',
  'tableInterestRate',
  'hidden md:block',
  'md:hidden',
  'data-mortgage-sort-option',
  'admin-mortgage-leads-table',
  'የቤት ብድር',
  'القسط الشهري التقريبي'
]) {
  assert(appSource.includes(expected) || indexHtml.includes(expected), `missing mortgage frontend marker: ${expected}`);
}

for (const expected of [
  "onclick=\"setMortgageTab('repayment')\"",
  "onclick=\"setMortgageTab('affordability')\"",
  "onclick=\"setMortgageTab('extra')\"",
  "onclick=\"setMortgageTab('fees')\"",
  'oninput="setMortgageManualRate(this.value)"',
  'onclick="loadMortgageRates(true)"',
  'onclick="saveMortgageCalculation()"',
  'onclick="requestMortgageHelp(\'\')"',
  'onclick="submitMortgageLead()"',
  'id="finder-mortgage-calculations"'
]) {
  assert(indexHtml.includes(expected) || appSource.includes(expected), `missing mortgage interactive marker: ${expected}`);
}

const mortgageHandlerExportBlock = (appSource.match(/function exposeMortgageFinderHandlers\(\) \{[\s\S]*?\n\}/) || [''])[0];

for (const handler of [
  'loadMortgageRates',
  'renderMortgageFinder',
  'requestMortgageHelp',
  'resetMortgageCalculator',
  'saveMortgageCalculation',
  'setMortgageComparisonSort',
  'setMortgageExtraPayment',
  'setMortgageLeadProvider',
  'setMortgageManualRate',
  'setMortgageTab',
  'submitMortgageLead',
  'syncMortgageInput',
  'syncMortgageSlider'
]) {
  assert(mortgageHandlerExportBlock.includes(handler), `mortgage handler is not exported to window: ${handler}`);
}

for (const expected of [
  "router.post('/mortgage-calculations'",
  'saved_mortgage_calculations',
  'mortgage_calculation_saved',
  'mortgageCalculations',
  "SUPPORTED_LANGUAGES = new Set(['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'])"
]) {
  assert(propertySeekerRoutes.includes(expected), `missing property seeker mortgage marker: ${expected}`);
}

for (const expected of [
  'mortgage_bank_callback',
  'bank_handoff_status',
  'ready_for_bank_export',
  'preferred_provider_name',
  'source_note',
  'public_record_disclosure',
  'logo_url',
  'notes = EXCLUDED.notes'
]) {
  assert(mortgageRoutes.includes(expected), `missing mortgage lead route marker: ${expected}`);
}

for (const expected of [
  'CREATE TABLE IF NOT EXISTS saved_mortgage_calculations',
  'preferred_provider_key TEXT',
  'preferred_provider_name TEXT',
  'payload JSONB NOT NULL',
  'idx_saved_mortgage_calculations_user_updated'
]) {
  assert(migration.includes(expected), `missing mortgage migration marker: ${expected}`);
}

assert(appSource.includes('Mortgage bank lead:'), 'King dashboard CRM rows should flag bank-specific mortgage leads');
assert(appSource.includes('/api/property-seeker/mortgage-calculations'), 'Save Calculation should call the property seeker save API');
assert(appSource.includes('mortgageRateManuallyEdited'), 'Mortgage calculator should preserve manual rate edits after defaulting to best bank rate');
assert(appSource.includes('getMortgageFeeEstimates'), 'Mortgage fee estimates should be centralized and source-auditable');
assert(appSource.includes('mortgageProviderBrand'), 'Mortgage comparison should attach provider logo/brand identity');
assert(appSource.includes('mortgageLogoSvgData'), 'Mortgage bank logos should be generated as local stable SVG badges');
assert(appSource.includes('logoSvg: mortgageLogoSvgData'), 'Mortgage known-provider brand map should include local SVG logo badges');
assert(appSource.includes('const logoSrc = brand.logoUrl || brand.logoSvg'), 'Mortgage logo renderer should prefer owned hosted logo files before generated fallback badges');
assert(appSource.includes('onerror="this.classList.add'), 'Mortgage bank logos should retain a text fallback when remote logos fail');
assert(appSource.includes('renderMortgageProviderLogo(result.best.provider'), 'Best-match card should include the lender logo/brand badge');
assert(appSource.includes('renderMortgageProviderLogo(row.provider'), 'Every mortgage comparison row should include the lender logo/brand badge');
assert(appSource.includes('sortMortgageProviderRows(result.providerRows)'), 'Mortgage comparison should sort lender rows before rendering');
assert(appSource.includes('setMortgageComparisonSort'), 'Mortgage comparison sort handler should exist');
assert(appSource.includes('mortgageRowMaxLtv'), 'Mortgage table should calculate max LTV from minimum deposit');
assert(appSource.includes('/api/admin/mortgage-leads?limit=20'), 'King dashboard should fetch the dedicated mortgage-leads queue');
assert(adminRoutes.includes("router.get('/mortgage-leads'"), 'admin API should expose a dedicated mortgage-leads endpoint');
assert(adminRoutes.includes('FROM mortgage_enquiries m'), 'mortgage-leads endpoint should read mortgage enquiries');
assert(adminRoutes.includes("l.metadata->>'mortgage_enquiry_id'"), 'mortgage-leads endpoint should correlate CRM leads to mortgage enquiries');
assert(indexHtml.includes('Mortgage Leads'), 'King dashboard should render a dedicated Mortgage Leads panel');
assert(indexHtml.includes('mortgage-finder-redesign-20260710'), 'frontend cache marker should include mortgage finder redesign');
for (const logoAsset of [
  'assets/mortgage-logos/stanbic.svg',
  'assets/mortgage-logos/hfb.svg',
  'assets/mortgage-logos/dfcu.svg',
  'assets/mortgage-logos/kcb.svg',
  'assets/mortgage-logos/ncba.svg',
  'assets/mortgage-logos/centenary.svg',
  'assets/mortgage-logos/baroda.svg',
  'assets/mortgage-logos/absa.svg',
  'assets/mortgage-logos/equity.svg'
]) {
  assert(fs.existsSync(path.join(root, logoAsset)), `missing owned mortgage logo asset: ${logoAsset}`);
}
assert(!appSource.includes('min-h-[360px]'), 'Mortgage result card should not force the calculator panel to leave large blank space');
for (const blockedLogoUrl of [
  'stanbicbank.co.ug/favicon.ico',
  'housingfinance.co.ug/favicon.ico',
  'dfcugroup.com/favicon.ico',
  'ug.kcbgroup.com/favicon.ico',
  'bankofbaroda.ug/favicon.ico',
  'absa.co.ug/favicon.ico',
  'ncbagroup.com/favicon.ico',
  'centenarybank.co.ug/favicon.ico'
]) {
  assert(!appSource.includes(blockedLogoUrl), `known mortgage logo should not depend on remote favicon URL: ${blockedLogoUrl}`);
}
assert(mortgageRoutes.includes('2026-06-21'), 'mortgage fallback provider source verification date should be refreshed');
assert(indexHtml.includes('mortgage-finder-redesign-20260710'), 'frontend cache marker should include mortgage finder redesign');

for (const lang of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
  const marker = lang === 'rn' ? 'MORTGAGE_I18N.rn = Object.assign' : `Object.assign(MORTGAGE_I18N.${lang}`;
  const chunk = appSource.slice(appSource.indexOf(marker), appSource.indexOf(marker) + 2400);
  assert(chunk.includes('mortgageStampDutyEstimate:'), `missing mortgage stamp-duty label for ${lang}`);
  assert(chunk.includes('valuationEstimate:'), `missing mortgage valuation label for ${lang}`);
  assert(chunk.includes('transferAndStampDutyEstimate:'), `missing mortgage transfer/stamp/valuation label for ${lang}`);
  assert(chunk.includes('bestRateApplied:'), `missing best-rate source line for ${lang}`);
  assert(chunk.includes('manualRateApplied:'), `missing manual-rate source line for ${lang}`);
  assert(chunk.includes('ratesAsOfLine:'), `missing rates-as-of label for ${lang}`);
  assert(chunk.includes('sortMonthly:'), `missing sort-monthly label for ${lang}`);
  assert(chunk.includes('tableMonthly:'), `missing table-monthly label for ${lang}`);
  assert(chunk.includes('bestMatchBadge:'), `missing best-match label for ${lang}`);
}

console.log('Mortgage lead generation tests passed');
