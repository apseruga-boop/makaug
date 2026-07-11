const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const server = read('server.js');
const app = read('assets/makaug-app.js');
const propertiesRoute = read('routes/properties.js');
const whatsappRoute = read('routes/whatsapp.js');

assert(html.includes('list-property-contact-id-required-20260710'), 'public app marker must identify the listing contact and ID correction');
assert(server.includes('listPropertyContactIdRequiredVersion'), 'server must include the contact and ID correction version in the public app suffix list');
assert(html.includes('list-property-create-fix-20260711'), 'public app marker must identify the list-property create fix');
assert(server.includes('listPropertyCreateFixVersion'), 'server must include the list-property create fix in the public app suffix list');

assert(html.includes('id="lp-otp-action-wrap" class="hidden'), 'online listing OTP controls must stay hidden from the public flow');
assert(html.includes('No OTP is needed for online listing submission.'), 'listing form must clearly say OTP is not needed');
assert(!html.includes('listing_otp_token is required. Verify OTP before submit'), 'public page must not restore OTP copy');

assert(html.includes('Contact & Verification'), 'step 3 must be contact and verification again');
assert(html.includes('Email, phone, and National ID details are required for review. No OTP is needed.'), 'step 3 must explain the corrected requirements');
assert(html.includes('Phone Number *'), 'online listing phone must be required');
assert(html.includes('Upload National ID Photo *'), 'online listing National ID upload must be required');
assert(html.includes('National ID Number (NIN) *'), 'online listing NIN field must be required');
assert(!html.includes('id="lp-verify-nin-wrap" class="hidden'), 'online listing NIN field must be visible');
assert(!html.includes('id="lp-verify-id-wrap" class="hidden'), 'online listing National ID upload must be visible');
assert(!html.includes('id="lp-verify-nin-match-wrap" class="hidden'), 'online listing NIN/photo confirmation must be visible');
assert(html.includes('Your ID is used only for verification and fraud prevention'), 'ID upload must reassure users it is not public');

assert(app.includes('Please add your email so makaug can send review updates.'), 'frontend step 3 must require email for review updates');
assert(app.includes('Please add the phone number buyers/tenants should use.'), 'frontend step 3 must require phone');
assert(app.includes('Please upload a photo of your National ID. PDFs are not accepted.'), 'frontend step 3 must require an ID photo image');
assert(app.includes('Please type your National ID number.'), 'frontend step 3 must require NIN');
assert(app.includes('Please confirm NIN matches uploaded ID.'), 'frontend step 3 must require NIN/photo confirmation');
assert(app.includes('listing_otp_token: null'), 'public online listing payload must not send a required OTP token');
assert(app.includes('otp_channel: "not_required"'), 'public online listing payload must mark OTP as not required');
assert(!app.includes('No phone number added, so contact method has been set to email enquiry.'), 'frontend must not silently downgrade contact preference when phone is missing');
assert(!app.includes('Please verify your email address with OTP before continuing.'), 'frontend step 3 must not require email OTP before continuing');
assert(app.includes('if (wasOther || isOther) renderLpPhotoFeedback();'), 'photo assignment should not re-render the full gallery on every normal category selection');

assert(propertiesRoute.includes('enforceWebsiteSubmissionRules'), 'backend must split website submission rules from broker fast track rules');
assert(propertiesRoute.includes('lister_email is required for online listing review updates'), 'backend must require email for public online submissions');
assert(propertiesRoute.includes('lister_phone is required for online listing contact'), 'backend must require phone for public online submissions');
assert(propertiesRoute.includes('id_number is required for online listing review'), 'backend must require NIN for public online submissions');
assert(propertiesRoute.includes('National ID photo is required. Upload a photo image; PDFs are not accepted'), 'backend must require ID photo for public online submissions');
assert(!propertiesRoute.includes('listing_otp_token is required. Verify OTP before submit'), 'backend must not require listing OTP for public online submissions');
assert(!/\benforceOtp\b/.test(propertiesRoute), 'backend create path must not reference the removed OTP enforcement flag');
assert(propertiesRoute.includes('storedSubmittedImageItems.slice(0, enforceWebsiteSubmissionRules ? websiteMaxImages : 20)'), 'backend image cap must use the website submission rule, not the removed OTP flag');

assert(whatsappRoute.includes("return respond(t(lang, 'askSelfie'), 'ask_selfie');"), 'WhatsApp listing flow must ask for ID photo after public name');
assert(whatsappRoute.includes("return respond(t(lang, 'askIDNumber'), 'ask_id_number');"), 'WhatsApp listing flow must ask for NIN after ID photo');
assert(whatsappRoute.includes("otp_channel: 'not_required'"), 'WhatsApp listing flow must mark OTP as not required');
assert(whatsappRoute.includes('submitWhatsappListingDraft({ phone, lang, draft: updatedDraft })'), 'WhatsApp listing flow must submit after NIN without asking for phone again');
assert(!whatsappRoute.includes("return respond(t(lang, 'askContactMethod'), 'ask_contact_method');\n  }\n\n  // CONTACT METHOD"), 'new WhatsApp listing path must not route public-name step to contact-method prompt');

console.log('List-property contact and ID correction tests passed');
