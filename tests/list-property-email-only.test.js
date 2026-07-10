const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const server = read('server.js');
const app = read('assets/makaug-app.js');
const propertiesRoute = read('routes/properties.js');

assert(html.includes('list-property-email-only-20260710'), 'public app marker must identify the email-only listing rollout');
assert(server.includes('listPropertyEmailOnlyVersion'), 'server must include the email-only listing version in the public app suffix list');
assert(html.includes('list-property-email-only-copy-fix-20260710'), 'public app marker must bust cache for the email-only copy hydration fix');
assert(server.includes('listPropertyEmailOnlyCopyFixVersion'), 'server must include the email-only copy fix version in the public app suffix list');
assert(html.includes('id="lp-otp-action-wrap" class="hidden'), 'online listing OTP controls must be hidden from the public flow');
assert(html.includes('id="lp-verify-nin-wrap" class="hidden'), 'online listing NIN field must be hidden from the public flow');
assert(html.includes('id="lp-verify-id-wrap" class="hidden'), 'online listing National ID upload must be hidden from the public flow');
assert(html.includes('No OTP is needed for online listing submission.'), 'listing form must clearly say OTP is not needed');
assert(html.includes('Email is required so makaug can send review updates'), 'listing form must present email as the required contact gate');
assert(app.includes('Email is required so makaug can send review updates. Phone, WhatsApp, and ID details are optional.'), 'listing app hydration must keep the email-only step 3 copy');
assert(!app.includes('translateListingLabel("Verification is required to reduce fraud and comply with Uganda regulations.")'), 'listing app hydration must not restore the old identity-verification subtitle');
assert(!html.includes('National ID Number (NIN) *'), 'public online listing form must not mark NIN as required');
assert(!html.includes('Upload National ID Photo *'), 'public online listing form must not mark ID photo as required');

assert(app.includes('Please add your email so makaug can send review updates.'), 'frontend step 3 must require email for review updates');
assert(app.includes('listing_otp_token: null'), 'public online listing payload must not send a required OTP token');
assert(app.includes('otp_channel: "not_required"'), 'public online listing payload must mark OTP as not required');
assert(!app.includes('Please complete all identity fields.'), 'frontend step 3 must not require full identity fields');
assert(!app.includes('markLpFieldError("lp-verify-id-file", "Please upload a photo of your National ID. PDFs are not accepted.")'), 'frontend step 3 must not require National ID upload before continuing');
assert(!app.includes('Please verify your email address with OTP before continuing.'), 'frontend step 3 must not require email OTP before continuing');
assert(app.includes('No phone number added, so contact method has been set to email enquiry.'), 'frontend should fall back to email contact when no phone is supplied');
assert(app.includes('if (wasOther || isOther) renderLpPhotoFeedback();'), 'photo assignment should not re-render the full gallery on every normal category selection');

assert(propertiesRoute.includes('enforceWebsiteSubmissionRules'), 'backend must split website submission rules from OTP enforcement');
assert(propertiesRoute.includes('lister_email is required for online listing review updates'), 'backend must require email for public online submissions');
assert(!propertiesRoute.includes('listing_otp_token is required. Verify OTP before submit'), 'backend must not require listing OTP for public online submissions');
assert(!propertiesRoute.includes('National ID photo is required. Upload a photo image; PDFs are not accepted'), 'backend must not require National ID photo for public online submissions');

console.log('List-property email-only regression tests passed');
