const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');

const officialLinks = {
  Instagram: 'https://instagram.com/makaugcom',
  LinkedIn: 'https://www.linkedin.com/company/makaug',
  YouTube: 'https://www.youtube.com/@makaugproperty',
  TikTok: 'https://www.tiktok.com/@makaug.com',
  Facebook: 'https://www.facebook.com/61592577775941/'
};

for (const [platform, href] of Object.entries(officialLinks)) {
  assert(
    indexHtml.includes(`href="${href}"`) && indexHtml.includes(`aria-label="${platform}"`),
    `${platform} must link to the approved Makaug account in the public footer`
  );
}

assert(!indexHtml.includes('https://youtube.com/@makaug'), 'The unrelated @makaug YouTube channel must never be linked');
assert(!appJs.includes('https://youtube.com/@makaug'), 'YouTube guide fallbacks must use the official Makaug channel');
assert(!indexHtml.includes('https://facebook.com/makaugcom'), 'The unavailable Facebook vanity URL must never be linked');

const officialYouTubeUses = `${indexHtml}\n${appJs}`.match(/https:\/\/www\.youtube\.com\/@makaugproperty/g) || [];
assert(officialYouTubeUses.length >= 4, 'Every footer and how-to YouTube fallback must use @makaugproperty');
assert(indexHtml.includes('official-social-links-20260805'), 'Release marker must be present');

console.log('official social links tests passed');
