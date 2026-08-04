const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const adminRoute = read('routes/admin.js');
const agentsRoute = read('routes/agents.js');
const emailService = read('services/emailService.js');
const html = read('index.html');
const app = read('assets/makaug-app.js');
const verificationRoute = agentsRoute.split("router.post('/me/verification'")[1]?.split("router.get('/'")[0] || '';

assert(adminRoute.includes("router.post('/agents/invite'"), 'King API must expose a broker-only invitation route');
assert(adminRoute.includes("status = CASE WHEN status = 'approved' THEN status ELSE 'pending' END"), 'invited brokers must remain pending until review');
assert(adminRoute.includes('pendingVerification: true'), 'broker invitation must provision access without pretending approval');
assert(adminRoute.includes('phone_verified = CASE WHEN $8::boolean THEN phone_verified ELSE TRUE END'), 'pending broker invitations must not falsely verify public phone numbers');
assert(adminRoute.includes('broker_phone_verification_required: false'), 'broker invitations must not require the unavailable OTP path');
assert(adminRoute.includes("broker_manual_phone_review_required: pendingVerification"), 'pending broker invitations must request manual phone review');
assert(!/router\.post\('\/agents\/invite'[\s\S]{0,9000}INSERT INTO properties/.test(adminRoute), 'agent-only invitation must not create a fake property');

assert(emailService.includes('sendBrokerInvitationEmail'), 'invited brokers must receive purpose-built access instructions');
assert(emailService.includes('No OTP is required; Makaug staff review these details'), 'invitation email must explain the manual trust review');
assert(emailService.includes('upload a clear photo of your National ID'), 'invitation email must explain private identity verification');
assert(emailService.includes('Nothing is published automatically'), 'invitation email must preserve moderation expectations');

assert(agentsRoute.includes("router.post('/me/verification'"), 'signed-in broker must have a private verification endpoint');
assert(!verificationRoute.includes('verifyListingSubmitToken'), 'invited broker trust submission must not require an OTP token');
assert(!verificationRoute.includes('contact_phone_verified_at = NOW()'), 'manual submission must not falsely mark a phone as technically verified');
assert(!verificationRoute.includes('phone_verified = TRUE'), 'manual submission must not falsely verify the user phone');
assert(verificationRoute.includes('phone_submitted_for_manual_review: true'), 'broker verification must route the phone to staff review');
assert(agentsRoute.includes('identity_document_uploaded: true'), 'broker verification must persist private ID evidence');
assert(agentsRoute.includes('agent?.identity_document_url && (agent?.phone || agent?.whatsapp)'), 'listing submission may proceed after contact and ID evidence are submitted');

assert(html.includes('data-release-marker="broker-agent-manual-trust-review-20260804"'), 'live HTML needs the manual trust review release marker');
assert(html.includes('id="admin-broker-invite-form"'), 'King dashboard must expose the agent-only invite form');
assert(html.includes('id="agent-verification-notice"'), 'broker dashboard must show first-login phone and National ID completion');
assert(html.includes('id="agent-invite-welcome"'), 'invited broker must receive a welcome screen');
assert(!html.includes('id="broker-verification-code"'), 'broker dashboard must not show an OTP input');
assert(html.includes('id="lp-video-url"'), 'listing flow must retain optional public video-tour URLs');

assert(app.includes('async function adminInviteBroker'), 'King UI must submit the broker invite');
assert(!app.includes('async function sendBrokerVerificationOtp'), 'broker dashboard must not call the unavailable OTP flow');
assert(app.includes('async function submitBrokerVerification'), 'broker dashboard must submit private verification evidence');
assert(app.includes('function isBrokerListingFastTrackReady'), 'listing flow must distinguish signed-in from verified brokers');
assert(app.includes('Submit your phone and National ID trust check in the broker dashboard before listing. No OTP is required.'), 'broker listing gate must point to manual trust review');
assert(app.includes('video_url: videoUrl || null'), 'broker listing payload must keep submitted video links');

console.log('ok - secure agent invite, manual first-login trust review, and reviewed listing upload are wired');
