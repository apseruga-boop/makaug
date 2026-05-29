const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

for (const expected of [
  'MORTGAGE_I18N.am',
  '"Original source": "ዋናው ምንጭ"',
  '"Contact via {platform} source": "በ{platform} ምንጭ በኩል ያግኙ"',
  '"Estimated from {amount} loan": "ከ {amount} ብድር ተገምቷል"',
  '"Best match": "ምርጥ ተዛማጅ"',
  'translateNearbyAmenityName',
  'if (lang === "en" && translations.en?.[key])'
]) {
  assert(appSource.includes(expected), `missing detail-page i18n regression marker: ${expected}`);
}

assert(!appSource.includes('font-semibold">Best match</div>'), 'mortgage best-match label must not be hard-coded in English');
assert(!appSource.includes('${formatUgxAmount(row.monthlyRepayment || 0)}/mo'), 'mortgage monthly row period must not be hard-coded as /mo');
assert(!appSource.includes('<div class="text-sm font-semibold text-gray-800 mb-2">Estimated from'), 'mortgage estimate line must not be hard-coded in English');
assert(htmlSource.includes('detail-container-i18n-20260529'), 'frontend cache version must be bumped for detail container i18n changes');

console.log('Detail page i18n regression tests passed');
